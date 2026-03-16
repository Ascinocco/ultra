import { randomUUID } from "node:crypto"
import type {
  ChatsStartThreadInput,
  ProjectId,
  RuntimeComponentSnapshot,
  RuntimeCoordinatorCommandResult,
  RuntimePauseProjectRuntimeInput,
  RuntimeResumeProjectRuntimeInput,
  RuntimeRetryThreadInput,
  ThreadDetailResult,
  ThreadMessageAttachment,
  ThreadMessageRole,
  ThreadMessageType,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import type { ProjectService } from "../projects/project-service.js"
import type { SandboxService } from "../sandboxes/sandbox-service.js"
import type { ThreadService } from "../threads/thread-service.js"
import type { RuntimeRegistry } from "./runtime-registry.js"
import type { RuntimeSupervisor } from "./runtime-supervisor.js"
import {
  isInteractiveSupervisedProcessHandle,
  type SupervisedProcessHandle,
  type SupervisedProcessSpec,
} from "./supervised-process-adapter.js"

type CoordinatorResponseEnvelope = {
  error?: {
    code?: string
    details?: unknown
    message?: string
  }
  kind?: string
  ok?: boolean
  request_id?: string
  result?: Record<string, unknown>
}

type CoordinatorEventEnvelope = {
  coordinator_id?: string
  coordinator_instance_id?: string
  event_type?: string
  kind?: string
  occurred_at?: string
  payload?: Record<string, unknown>
  project_id?: string
  sequence_number?: number
  thread_id?: string
}

type CoordinatorSessionState = {
  componentId: string | null
  detachStderr: (() => void) | null
  detachStdout: (() => void) | null
  detachExit: (() => void) | null
  handle:
    | (SupervisedProcessHandle &
        Required<
          Pick<
            SupervisedProcessHandle,
            "onStderrLine" | "onStdoutLine" | "writeLine"
          >
        >)
    | null
  helloRequestId: string | null
  lastHelloPid: number | null
  latestSequenceByInstanceId: Map<string, number>
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeComponentHealth(
  status: string | undefined,
): "healthy" | "degraded" | "down" {
  if (!status) {
    return "healthy"
  }

  const normalized = status.toLowerCase()
  if (
    normalized.includes("down") ||
    normalized.includes("offline") ||
    normalized.includes("failed")
  ) {
    return "down"
  }

  if (
    normalized.includes("degraded") ||
    normalized.includes("error") ||
    normalized.includes("stalled")
  ) {
    return "degraded"
  }

  return "healthy"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeThreadMessageRole(value: unknown): ThreadMessageRole {
  switch (value) {
    case "user":
      return "user"
    case "system":
      return "system"
    default:
      return "coordinator"
  }
}

function normalizeThreadMessageType(value: unknown): ThreadMessageType {
  switch (value) {
    case "status":
    case "blocking_question":
    case "summary":
    case "review_ready":
    case "change_request_followup":
      return value
    default:
      return "text"
  }
}

function buildCoordinatorId(projectId: ProjectId): string {
  return `coord_${projectId}`
}

export class CoordinatorService {
  private readonly backendInstanceId = `backend_${randomUUID()}`
  private readonly sessionsByProjectId = new Map<
    ProjectId,
    CoordinatorSessionState
  >()

  constructor(
    private readonly runtimeSupervisor: RuntimeSupervisor,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly projectService: ProjectService,
    private readonly sandboxService: SandboxService,
    private readonly threadService: ThreadService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.runtimeSupervisor.subscribeToHandleLaunches(
      (componentId, handle, spec) => {
        if (spec.componentType !== "coordinator" || !spec.projectId) {
          return
        }

        this.attachHandle(spec.projectId, componentId, handle)
      },
    )
  }

  ensureRunning(projectId: ProjectId): RuntimeComponentSnapshot {
    const project = this.projectService.get(projectId)
    const component = this.runtimeSupervisor.ensureRunning(
      this.buildCoordinatorSpec(project.id, project.rootPath),
    )
    const handle = this.runtimeSupervisor.getLiveHandle(component.componentId)

    if (!handle || !isInteractiveSupervisedProcessHandle(handle)) {
      this.markCoordinatorUnavailable(
        projectId,
        "Project coordinator did not expose an interactive stdio transport.",
      )
      throw new IpcProtocolError(
        "runtime_unavailable",
        "Project coordinator is not available.",
      )
    }

    this.attachHandle(projectId, component.componentId, handle)
    this.sendHello(projectId, handle.pid ?? null)
    return component
  }

  startThread(input: {
    input: ChatsStartThreadInput
    thread: ThreadDetailResult
  }): void {
    const { thread } = input.thread
    this.dispatchCommand(
      thread.projectId,
      "start_thread",
      {
        attachments: [],
        chat_refs: [
          {
            chat_id: thread.sourceChatId,
            message_ids: [
              input.input.plan_approval_message_id,
              input.input.spec_approval_message_id,
              input.input.start_request_message_id,
            ],
          },
        ],
        checkout_context: this.buildCheckoutContext(
          thread.projectId,
          thread.id,
        ),
        execution_summary:
          input.thread.thread.summary ?? input.thread.thread.title,
        spec_markdown: this.buildSpecMarkdown(input.thread),
        thread_title: input.thread.thread.title,
        ticket_refs: input.thread.ticketRefs.map((ticketRef) => ({
          display_label: ticketRef.displayLabel,
          metadata: ticketRef.metadata,
          provider: ticketRef.provider,
          ticket_id: ticketRef.externalId,
          url: ticketRef.url,
        })),
      },
      thread.id,
    )
  }

  sendThreadMessage(input: {
    attachments: ThreadMessageAttachment[]
    contentMarkdown: string
    messageId: string
    projectId: ProjectId
    threadId: string
  }): void {
    this.assertThreadInProject(input.projectId, input.threadId)
    this.dispatchCommand(
      input.projectId,
      "send_thread_message",
      {
        attachments: input.attachments,
        content_markdown: input.contentMarkdown,
        message_id: input.messageId,
        role: "user",
      },
      input.threadId,
    )
  }

  retryThread(input: RuntimeRetryThreadInput): RuntimeCoordinatorCommandResult {
    this.assertThreadInProject(input.project_id, input.thread_id)
    this.dispatchCommand(
      input.project_id,
      "retry_thread",
      { reason: "Retry requested from Ultra." },
      input.thread_id,
    )

    return {
      accepted: true,
      message: "Retry requested.",
    }
  }

  pauseProjectRuntime(
    input: RuntimePauseProjectRuntimeInput,
  ): RuntimeCoordinatorCommandResult {
    this.projectService.get(input.project_id)
    this.dispatchCommand(input.project_id, "pause_project_runtime", {
      reason: "Pause requested from Ultra.",
    })

    return {
      accepted: true,
      message: "Project runtime pause requested.",
    }
  }

  resumeProjectRuntime(
    input: RuntimeResumeProjectRuntimeInput,
  ): RuntimeCoordinatorCommandResult {
    this.projectService.get(input.project_id)
    this.dispatchCommand(input.project_id, "resume_project_runtime", {
      reason: "Resume requested from Ultra.",
    })

    return {
      accepted: true,
      message: "Project runtime resume requested.",
    }
  }

  private attachHandle(
    projectId: ProjectId,
    componentId: string,
    rawHandle: SupervisedProcessHandle,
  ): void {
    if (!isInteractiveSupervisedProcessHandle(rawHandle)) {
      return
    }

    const state = this.getOrCreateSession(projectId)
    if (state.handle === rawHandle) {
      state.componentId = componentId
      return
    }

    state.detachStdout?.()
    state.detachStderr?.()
    state.detachExit?.()
    state.componentId = componentId
    state.handle = rawHandle
    state.lastHelloPid = null
    state.helloRequestId = null

    state.detachStdout = rawHandle.onStdoutLine((line) => {
      this.processStdoutLine(projectId, componentId, line)
    })
    state.detachStderr = rawHandle.onStderrLine((line) => {
      this.markCoordinatorUnavailable(projectId, `Coordinator stderr: ${line}`)
    })
    state.detachExit = rawHandle.onExit(() => {
      state.handle = null
      state.lastHelloPid = null
      state.helloRequestId = null
    })
  }

  private buildCoordinatorSpec(
    projectId: ProjectId,
    rootPath: string,
  ): SupervisedProcessSpec {
    return {
      args: ["coordinator"],
      command: "ov",
      componentType: "coordinator",
      cwd: rootPath,
      details: {
        args: ["coordinator"],
        command: "ov",
        cwd: rootPath,
        coordinatorId: buildCoordinatorId(projectId),
        projectId,
      },
      env: {
        ULTRA_COORDINATOR_ID: buildCoordinatorId(projectId),
        ULTRA_PROJECT_ID: projectId,
        ULTRA_PROJECT_ROOT: rootPath,
      },
      projectId,
      scope: "project",
    }
  }

  private buildCheckoutContext(
    projectId: ProjectId,
    threadId: string,
  ): Record<string, unknown> {
    const sandbox =
      this.sandboxService.resolveThreadSandbox(projectId, threadId) ??
      this.sandboxService.getActive(projectId)

    return {
      base_branch: sandbox.baseBranch,
      branch_name: sandbox.branchName,
      target_id: sandbox.sandboxId,
      worktree_path: sandbox.path,
    }
  }

  private buildSpecMarkdown(thread: ThreadDetailResult): string {
    if (thread.specRefs.length === 0) {
      return ""
    }

    return thread.specRefs.map((specRef) => `- ${specRef.specPath}`).join("\n")
  }

  private dispatchCommand(
    projectId: ProjectId,
    command: string,
    payload: Record<string, unknown>,
    threadId?: string,
  ): void {
    this.ensureRunning(projectId)
    const state = this.getOrCreateSession(projectId)

    if (!state.handle) {
      throw new IpcProtocolError(
        "runtime_unavailable",
        "Project coordinator is not available.",
      )
    }

    try {
      state.handle.writeLine(
        JSON.stringify({
          command,
          coordinator_id: buildCoordinatorId(projectId),
          kind: "command",
          payload,
          project_id: projectId,
          protocol_version: "1.0",
          request_id: `coord_req_${randomUUID()}`,
          ...(threadId ? { thread_id: threadId } : {}),
        }),
      )
    } catch (error) {
      const reason = normalizeErrorMessage(error)
      this.markCoordinatorUnavailable(projectId, reason)
      throw new IpcProtocolError(
        "runtime_unavailable",
        `Failed to dispatch coordinator command: ${reason}`,
      )
    }
  }

  private sendHello(projectId: ProjectId, pid: number | null): void {
    const state = this.getOrCreateSession(projectId)

    if (!state.handle || state.lastHelloPid === pid) {
      return
    }

    state.lastHelloPid = pid
    state.helloRequestId = `coord_req_hello_${randomUUID()}`
    state.handle.writeLine(
      JSON.stringify({
        command: "hello",
        coordinator_id: buildCoordinatorId(projectId),
        kind: "command",
        payload: {
          backend_instance_id: this.backendInstanceId,
          supported_protocol_versions: ["1.0"],
        },
        project_id: projectId,
        protocol_version: "1.0",
        request_id: state.helloRequestId,
      }),
    )
  }

  private processStdoutLine(
    projectId: ProjectId,
    componentId: string,
    line: string,
  ): void {
    let parsed: unknown

    try {
      parsed = JSON.parse(line)
    } catch (error) {
      this.markCoordinatorUnavailable(
        projectId,
        `Coordinator emitted malformed JSON: ${normalizeErrorMessage(error)}`,
      )
      return
    }

    if (!isRecord(parsed) || typeof parsed.kind !== "string") {
      return
    }

    if (parsed.kind === "response") {
      this.processResponse(
        projectId,
        componentId,
        parsed as CoordinatorResponseEnvelope,
      )
      return
    }

    if (parsed.kind === "event") {
      this.processEvent(
        projectId,
        componentId,
        parsed as CoordinatorEventEnvelope,
      )
    }
  }

  private processResponse(
    projectId: ProjectId,
    componentId: string,
    response: CoordinatorResponseEnvelope,
  ): void {
    const state = this.getOrCreateSession(projectId)
    if (response.request_id !== state.helloRequestId) {
      return
    }

    if (!response.ok || !isRecord(response.result)) {
      const errorMessage =
        response.error?.message ?? "Coordinator hello handshake failed."
      this.markCoordinatorUnavailable(projectId, errorMessage)
      return
    }

    const now = this.now()
    const currentComponent =
      this.runtimeRegistry.getRuntimeComponent(componentId)
    const coordinatorId =
      typeof response.result.coordinator_id === "string"
        ? response.result.coordinator_id
        : buildCoordinatorId(projectId)
    const coordinatorInstanceId =
      typeof response.result.coordinator_instance_id === "string"
        ? response.result.coordinator_instance_id
        : null

    this.runtimeRegistry.upsertRuntimeComponent({
      componentId,
      componentType: "coordinator",
      details: {
        ...(currentComponent?.details ?? {}),
        capabilities: response.result.capabilities ?? null,
        coordinatorId,
        coordinatorInstanceId,
        coordinatorVersion: response.result.coordinator_version ?? null,
      },
      lastHeartbeatAt: now,
      processId: currentComponent?.processId ?? state.handle?.pid ?? null,
      projectId,
      reason: null,
      restartCount: currentComponent?.restartCount ?? 0,
      scope: "project",
      startedAt: currentComponent?.startedAt ?? now,
      status: "healthy",
    })
    this.runtimeRegistry.upsertProjectRuntime({
      coordinatorId,
      coordinatorInstanceId,
      lastHeartbeatAt: now,
      projectId,
      restartCount: currentComponent?.restartCount ?? 0,
      startedAt: currentComponent?.startedAt ?? now,
      status: "running",
    })
    this.threadService.updateProjectCoordinatorHealth(projectId, "healthy")
  }

  private processEvent(
    projectId: ProjectId,
    componentId: string,
    event: CoordinatorEventEnvelope,
  ): void {
    if (
      event.project_id !== projectId ||
      typeof event.coordinator_instance_id !== "string" ||
      typeof event.sequence_number !== "number"
    ) {
      return
    }

    const state = this.getOrCreateSession(projectId)
    const lastSequence =
      state.latestSequenceByInstanceId.get(event.coordinator_instance_id) ?? 0

    if (event.sequence_number <= lastSequence) {
      return
    }

    state.latestSequenceByInstanceId.set(
      event.coordinator_instance_id,
      event.sequence_number,
    )

    switch (event.event_type) {
      case "heartbeat":
        this.applyHeartbeat(projectId, componentId, event)
        return
      case "runtime_status_changed":
        this.applyRuntimeStatusChanged(projectId, componentId, event)
        return
      case "thread_execution_state_changed":
        if (typeof event.thread_id === "string") {
          this.threadService.appendProjectedEvent({
            actorId: event.coordinator_id ?? null,
            actorType: "coordinator",
            eventType: "thread.execution_state_changed",
            payload: event.payload ?? {},
            projectId,
            source: "ov.coordinator",
            threadId: event.thread_id,
            ...(event.occurred_at ? { occurredAt: event.occurred_at } : {}),
          })
        }
        return
      case "thread_blocked":
        if (typeof event.thread_id === "string") {
          this.threadService.appendProjectedEvent({
            actorId: event.coordinator_id ?? null,
            actorType: "coordinator",
            eventType: "thread.blocked",
            payload: event.payload ?? {},
            projectId,
            source: "ov.coordinator",
            threadId: event.thread_id,
            ...(event.occurred_at ? { occurredAt: event.occurred_at } : {}),
          })
        }
        return
      case "thread_review_ready":
        if (typeof event.thread_id === "string") {
          this.threadService.appendProjectedEvent({
            actorId: event.coordinator_id ?? null,
            actorType: "coordinator",
            eventType: "thread.review_ready",
            payload: event.payload ?? {},
            projectId,
            source: "ov.coordinator",
            threadId: event.thread_id,
            ...(event.occurred_at ? { occurredAt: event.occurred_at } : {}),
          })
        }
        return
      case "thread_message_emitted":
        this.applyThreadMessage(projectId, event)
        return
      case "thread_agent_started":
      case "thread_agent_progressed":
      case "thread_agent_finished":
      case "thread_agent_failed":
      case "thread_log_chunk":
        this.applyMappedThreadEvent(projectId, event)
        return
      case "error":
        this.applyErrorEvent(projectId, event)
        return
      default:
        return
    }
  }

  private applyHeartbeat(
    projectId: ProjectId,
    componentId: string,
    event: CoordinatorEventEnvelope,
  ): void {
    const payload = event.payload ?? {}
    const lastHeartbeatAt =
      typeof payload.last_heartbeat_at === "string"
        ? payload.last_heartbeat_at
        : (event.occurred_at ?? this.now())
    const status =
      typeof payload.status === "string" ? payload.status : "healthy"
    const currentComponent =
      this.runtimeRegistry.getRuntimeComponent(componentId)

    this.runtimeRegistry.upsertRuntimeComponent({
      componentId,
      componentType: "coordinator",
      details: {
        ...(currentComponent?.details ?? {}),
        coordinatorId: event.coordinator_id ?? buildCoordinatorId(projectId),
        coordinatorInstanceId: event.coordinator_instance_id,
      },
      lastHeartbeatAt,
      processId: currentComponent?.processId ?? null,
      projectId,
      reason: null,
      restartCount: currentComponent?.restartCount ?? 0,
      scope: "project",
      startedAt: currentComponent?.startedAt ?? lastHeartbeatAt,
      status: normalizeComponentHealth(status),
    })
    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: event.occurred_at ?? this.now(),
      componentId,
      details: currentComponent?.details ?? null,
      lastHeartbeatAt,
      projectId,
      reason: null,
      status: normalizeComponentHealth(status),
    })
    this.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: event.coordinator_id ?? buildCoordinatorId(projectId),
      coordinatorInstanceId: event.coordinator_instance_id ?? null,
      lastHeartbeatAt,
      projectId,
      restartCount: currentComponent?.restartCount ?? 0,
      startedAt: currentComponent?.startedAt ?? lastHeartbeatAt,
      status,
    })
    this.threadService.updateProjectCoordinatorHealth(
      projectId,
      normalizeComponentHealth(status),
    )
  }

  private applyRuntimeStatusChanged(
    projectId: ProjectId,
    componentId: string,
    event: CoordinatorEventEnvelope,
  ): void {
    const payload = event.payload ?? {}
    const toStatus =
      typeof payload.to_status === "string" ? payload.to_status : "healthy"
    const reason = typeof payload.reason === "string" ? payload.reason : null
    const restartCount =
      typeof payload.restart_count === "number" ? payload.restart_count : 0
    const currentComponent =
      this.runtimeRegistry.getRuntimeComponent(componentId)
    const lastHeartbeatAt = event.occurred_at ?? this.now()

    this.runtimeRegistry.upsertRuntimeComponent({
      componentId,
      componentType: "coordinator",
      details: {
        ...(currentComponent?.details ?? {}),
        coordinatorId: event.coordinator_id ?? buildCoordinatorId(projectId),
        coordinatorInstanceId: event.coordinator_instance_id,
      },
      lastHeartbeatAt,
      processId: currentComponent?.processId ?? null,
      projectId,
      reason,
      restartCount,
      scope: "project",
      startedAt: currentComponent?.startedAt ?? lastHeartbeatAt,
      status: normalizeComponentHealth(toStatus),
    })
    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: lastHeartbeatAt,
      componentId,
      details: currentComponent?.details ?? null,
      lastHeartbeatAt,
      projectId,
      reason,
      status: normalizeComponentHealth(toStatus),
    })
    this.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: event.coordinator_id ?? buildCoordinatorId(projectId),
      coordinatorInstanceId: event.coordinator_instance_id ?? null,
      lastHeartbeatAt,
      projectId,
      restartCount,
      startedAt: currentComponent?.startedAt ?? lastHeartbeatAt,
      status: toStatus,
    })
    this.threadService.updateProjectCoordinatorHealth(
      projectId,
      normalizeComponentHealth(toStatus),
    )
  }

  private applyThreadMessage(
    projectId: ProjectId,
    event: CoordinatorEventEnvelope,
  ): void {
    if (typeof event.thread_id !== "string" || !event.payload) {
      return
    }

    this.threadService.appendMessage({
      attachments: Array.isArray(event.payload.attachments)
        ? (event.payload.attachments.filter(
            isRecord,
          ) as ThreadMessageAttachment[])
        : [],
      contentText:
        typeof event.payload.content_markdown === "string"
          ? event.payload.content_markdown
          : typeof event.payload.text === "string"
            ? event.payload.text
            : "",
      createdAt: event.occurred_at ?? this.now(),
      messageType: normalizeThreadMessageType(event.payload.message_type),
      projectId,
      role: normalizeThreadMessageRole(event.payload.role),
      threadId: event.thread_id,
      ...(typeof event.payload.message_id === "string"
        ? { messageId: event.payload.message_id }
        : {}),
    })
  }

  private applyMappedThreadEvent(
    projectId: ProjectId,
    event: CoordinatorEventEnvelope,
  ): void {
    if (typeof event.thread_id !== "string" || !event.event_type) {
      return
    }

    const mappedEventType = event.event_type.replace(/^thread_/, "thread.")
    this.threadService.appendProjectedEvent({
      actorId: event.coordinator_id ?? null,
      actorType: "coordinator",
      eventType: mappedEventType,
      payload: event.payload ?? {},
      projectId,
      source: "ov.coordinator",
      threadId: event.thread_id,
      ...(event.occurred_at ? { occurredAt: event.occurred_at } : {}),
    })
  }

  private applyErrorEvent(
    projectId: ProjectId,
    event: CoordinatorEventEnvelope,
  ): void {
    const payload = event.payload ?? {}
    const reason =
      typeof payload.message === "string"
        ? payload.message
        : "Coordinator reported an error."

    if (typeof event.thread_id === "string") {
      this.threadService.appendProjectedEvent({
        actorId: event.coordinator_id ?? null,
        actorType: "coordinator",
        eventType:
          payload.retryable === true
            ? "thread.health_changed"
            : "thread.failed",
        payload:
          payload.retryable === true
            ? {
                coordinator_health: "degraded",
                reason,
              }
            : {
                reason,
              },
        projectId,
        source: "ov.coordinator",
        threadId: event.thread_id,
        ...(event.occurred_at ? { occurredAt: event.occurred_at } : {}),
      })
    }

    this.markCoordinatorUnavailable(projectId, reason)
  }

  private assertThreadInProject(projectId: ProjectId, threadId: string): void {
    const thread = this.threadService.getThread(threadId).thread

    if (thread.projectId !== projectId) {
      throw new IpcProtocolError(
        "not_found",
        `Thread ${threadId} does not belong to project ${projectId}.`,
      )
    }
  }

  private getOrCreateSession(projectId: ProjectId): CoordinatorSessionState {
    const existing = this.sessionsByProjectId.get(projectId)

    if (existing) {
      return existing
    }

    const state: CoordinatorSessionState = {
      componentId: null,
      detachExit: null,
      detachStderr: null,
      detachStdout: null,
      handle: null,
      helloRequestId: null,
      lastHelloPid: null,
      latestSequenceByInstanceId: new Map(),
    }
    this.sessionsByProjectId.set(projectId, state)
    return state
  }

  private markCoordinatorUnavailable(
    projectId: ProjectId,
    reason: string,
  ): void {
    const currentComponent = this.runtimeRegistry.getProjectRuntimeComponent(
      projectId,
      "coordinator",
    )
    const timestamp = this.now()
    const component = this.runtimeRegistry.upsertRuntimeComponent({
      ...(currentComponent
        ? { componentId: currentComponent.componentId }
        : {}),
      componentType: "coordinator",
      details: currentComponent?.details ?? {
        coordinatorId: buildCoordinatorId(projectId),
        projectId,
      },
      lastHeartbeatAt: timestamp,
      processId: null,
      projectId,
      reason,
      restartCount: currentComponent?.restartCount ?? 0,
      scope: "project",
      startedAt: currentComponent?.startedAt ?? null,
      status: "down",
    })
    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: timestamp,
      componentId: component.componentId,
      details: component.details,
      lastHeartbeatAt: timestamp,
      projectId,
      reason,
      status: "down",
    })
    const currentRuntime = this.runtimeRegistry.ensureProjectRuntime(projectId)
    this.runtimeRegistry.upsertProjectRuntime({
      coordinatorId:
        currentRuntime.coordinatorId ?? buildCoordinatorId(projectId),
      coordinatorInstanceId: currentRuntime.coordinatorInstanceId,
      lastHeartbeatAt: timestamp,
      projectId,
      restartCount: Math.max(
        currentRuntime.restartCount,
        currentComponent?.restartCount ?? 0,
      ),
      startedAt: currentRuntime.startedAt,
      status: "degraded",
    })
    this.threadService.updateProjectCoordinatorHealth(projectId, "down")
  }
}
