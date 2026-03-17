import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  ProjectId,
  RuntimeComponentSnapshot,
  RuntimeDetails,
} from "@ultra/shared"

import type { ProjectService } from "../projects/project-service.js"
import type { ThreadService } from "../threads/thread-service.js"
import type { RuntimeRegistry } from "./runtime-registry.js"
import type { RuntimeSupervisor } from "./runtime-supervisor.js"
import {
  isInteractiveSupervisedProcessHandle,
  type SupervisedProcessHandle,
  type SupervisedProcessSpec,
} from "./supervised-process-adapter.js"
import {
  WATCHDOG_ACTIVE_CADENCE_MS,
  WATCHDOG_IDLE_CADENCE_MS,
  WATCHDOG_STUCK_THRESHOLD_MS,
  WATCHDOG_SUSPECT_THRESHOLD_MS,
  type WatchdogCoordinatorSnapshot,
  type WatchdogProbeResult,
} from "./watchdog-helper.js"

type WatchdogHealth = "healthy" | "degraded" | "down"

type WatchdogSessionState = {
  componentId: string | null
  coordinatorSnapshot: WatchdogCoordinatorSnapshot | null
  detachExit: (() => void) | null
  detachStderr: (() => void) | null
  detachStdout: (() => void) | null
  handle:
    | (SupervisedProcessHandle &
        Required<
          Pick<
            SupervisedProcessHandle,
            "onStderrLine" | "onStdoutLine" | "writeLine"
          >
        >)
    | null
  lastHelloPid: number | null
  skipNextExitFailure: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildExitReason(event: {
  code: number | null
  error?: string | null
  signal: NodeJS.Signals | null
}): string {
  if (event.error) {
    return event.error
  }

  if (event.signal) {
    return `Watchdog helper exited due to signal ${event.signal}.`
  }

  if (event.code === null) {
    return "Watchdog helper exited unexpectedly."
  }

  return `Watchdog helper exited with code ${event.code}.`
}

function mapProbeStateToHealth(state: string): WatchdogHealth {
  switch (state) {
    case "stuck":
      return "down"
    case "suspect":
      return "degraded"
    default:
      return "healthy"
  }
}

function parseWatchdogProbeResult(line: string): WatchdogProbeResult | null {
  const parsed = JSON.parse(line) as unknown

  if (
    !isRecord(parsed) ||
    parsed.kind !== "probe_result" ||
    !isRecord(parsed.payload)
  ) {
    return null
  }

  const payload = parsed.payload

  if (
    typeof payload.project_id !== "string" ||
    typeof payload.checked_at !== "string" ||
    typeof payload.probe_state !== "string" ||
    typeof payload.component_status !== "string" ||
    !Array.isArray(payload.active_thread_ids) ||
    !payload.active_thread_ids.every((entry) => typeof entry === "string") ||
    (typeof payload.last_heartbeat_at !== "string" &&
      payload.last_heartbeat_at !== null) ||
    (typeof payload.reason !== "string" && payload.reason !== null)
  ) {
    return null
  }

  return {
    active_thread_ids: payload.active_thread_ids,
    checked_at: payload.checked_at,
    component_status:
      payload.component_status === "down" ||
      payload.component_status === "degraded"
        ? payload.component_status
        : "healthy",
    last_heartbeat_at: payload.last_heartbeat_at,
    probe_state:
      payload.probe_state === "stuck" || payload.probe_state === "suspect"
        ? payload.probe_state
        : "idle",
    project_id: payload.project_id,
    reason: payload.reason,
  }
}

export class WatchdogService {
  private readonly sessionsByProjectId = new Map<
    ProjectId,
    WatchdogSessionState
  >()
  private readonly helperPath: string

  constructor(
    private readonly runtimeSupervisor: RuntimeSupervisor,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly projectService: ProjectService,
    private readonly threadService: ThreadService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    const currentFilePath = fileURLToPath(import.meta.url)
    const extension = extname(currentFilePath)
    this.helperPath = join(
      dirname(currentFilePath),
      `watchdog-helper${extension}`,
    )

    this.runtimeSupervisor.subscribeToHandleLaunches(
      (componentId, handle, spec) => {
        if (spec.componentType !== "watchdog" || !spec.projectId) {
          return
        }

        this.attachHandle(spec.projectId, componentId, handle)
      },
    )
  }

  ensureRunning(projectId: ProjectId): RuntimeComponentSnapshot {
    const project = this.projectService.get(projectId)

    try {
      const component = this.runtimeSupervisor.ensureRunning(
        this.buildWatchdogSpec(project.id, project.rootPath),
      )
      const handle = this.runtimeSupervisor.getLiveHandle(component.componentId)

      if (!handle || !isInteractiveSupervisedProcessHandle(handle)) {
        return this.markUnavailable(
          project.id,
          "Watchdog helper did not expose an interactive stdio transport.",
        )
      }

      this.attachHandle(project.id, component.componentId, handle)
      this.flushSnapshot(project.id)
      return component
    } catch (error) {
      return this.markUnavailable(project.id, normalizeErrorMessage(error))
    }
  }

  updateCoordinatorSnapshot(snapshot: WatchdogCoordinatorSnapshot): void {
    const state = this.getOrCreateSession(snapshot.project_id)
    state.coordinatorSnapshot = snapshot

    const component = this.runtimeRegistry.getProjectRuntimeComponent(
      snapshot.project_id,
      "watchdog",
    )

    if (!component) {
      return
    }

    this.flushSnapshot(snapshot.project_id)
  }

  handleCoordinatorUnavailable(projectId: ProjectId, reason: string): void {
    const component = this.runtimeRegistry.getProjectRuntimeComponent(
      projectId,
      "watchdog",
    )
    const state = this.getOrCreateSession(projectId)
    const previousStatus = component?.status ?? "healthy"

    if (state.handle) {
      state.skipNextExitFailure = true
      try {
        state.handle.writeLine(JSON.stringify({ kind: "shutdown" }))
      } catch {
        // Best-effort shutdown for interactive helper.
      }
    }

    if (component) {
      this.runtimeSupervisor.stop(component.componentId)
    }

    this.markUnavailable(projectId, reason, previousStatus !== "down")
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
    state.skipNextExitFailure = false

    state.detachStdout = rawHandle.onStdoutLine((line) => {
      this.processStdoutLine(projectId, componentId, line)
    })
    state.detachStderr = rawHandle.onStderrLine((_line) => {
      // stderr is diagnostic-only for the watchdog helper in v1
    })
    state.detachExit = rawHandle.onExit((event) => {
      state.handle = null
      state.lastHelloPid = null
      if (state.skipNextExitFailure) {
        state.skipNextExitFailure = false
        return
      }

      queueMicrotask(() => {
        this.handleHelperFailure(projectId, buildExitReason(event))
      })
    })
  }

  private processStdoutLine(
    projectId: ProjectId,
    componentId: string,
    line: string,
  ): void {
    let probe: WatchdogProbeResult | null = null

    try {
      probe = parseWatchdogProbeResult(line)
    } catch (error) {
      this.handleHelperFailure(
        projectId,
        `Watchdog helper emitted malformed JSON: ${normalizeErrorMessage(error)}`,
      )
      return
    }

    if (!probe || probe.project_id !== projectId) {
      return
    }

    this.applyProbeResult(projectId, componentId, probe)
  }

  private applyProbeResult(
    projectId: ProjectId,
    componentId: string,
    probe: WatchdogProbeResult,
  ): void {
    const currentComponent =
      this.runtimeRegistry.getRuntimeComponent(componentId) ??
      this.runtimeRegistry.getProjectRuntimeComponent(projectId, "watchdog")
    const snapshot = this.getOrCreateSession(projectId).coordinatorSnapshot
    const previousStatus = currentComponent?.status ?? "healthy"
    const heartbeatAgeMs = this.computeHeartbeatAgeMs(
      probe.checked_at,
      probe.last_heartbeat_at,
    )
    const details = this.buildProbeDetails(probe, snapshot, heartbeatAgeMs)
    const status = mapProbeStateToHealth(probe.probe_state)

    const component = this.runtimeRegistry.upsertRuntimeComponent({
      componentId: currentComponent?.componentId ?? componentId,
      componentType: "watchdog",
      details,
      lastHeartbeatAt: probe.checked_at,
      processId: currentComponent?.processId ?? null,
      projectId,
      reason: probe.reason,
      restartCount: currentComponent?.restartCount ?? 0,
      scope: "project",
      startedAt: currentComponent?.startedAt ?? probe.checked_at,
      status,
    })

    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: probe.checked_at,
      componentId: component.componentId,
      details,
      lastHeartbeatAt: probe.last_heartbeat_at,
      projectId,
      reason: probe.reason,
      status,
    })

    const runtime = this.runtimeRegistry.ensureProjectRuntime(projectId)
    this.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: runtime.coordinatorId,
      coordinatorInstanceId:
        snapshot?.coordinator_instance_id ?? runtime.coordinatorInstanceId,
      lastHeartbeatAt: probe.checked_at,
      projectId,
      restartCount: Math.max(runtime.restartCount, component.restartCount),
      startedAt: runtime.startedAt,
      status: this.deriveProjectRuntimeStatus(projectId, status),
    })

    if (previousStatus !== status) {
      this.emitThreadHealthChanges(
        projectId,
        probe.active_thread_ids.length > 0
          ? probe.active_thread_ids
          : this.threadService.listNonTerminalThreadIds(projectId),
        status,
        probe.reason,
        probe.checked_at,
      )
    }
  }

  private handleHelperFailure(
    projectId: ProjectId,
    reason: string,
    forceEmit = false,
  ): void {
    const currentComponent = this.runtimeRegistry.getProjectRuntimeComponent(
      projectId,
      "watchdog",
    )
    const timestamp = this.now()
    const status: WatchdogHealth = "down"
    const details = this.buildProbeDetails(
      {
        active_thread_ids:
          this.threadService.listActiveCoordinatorThreadIds(projectId),
        checked_at: timestamp,
        probe_state: "stuck",
        reason,
      },
      this.getOrCreateSession(projectId).coordinatorSnapshot,
      this.computeHeartbeatAgeMs(
        timestamp,
        currentComponent?.lastHeartbeatAt ?? null,
      ),
    )
    const previousStatus = currentComponent?.status ?? "healthy"

    const component = this.runtimeRegistry.upsertRuntimeComponent({
      ...(currentComponent
        ? { componentId: currentComponent.componentId }
        : {}),
      componentType: "watchdog",
      details,
      lastHeartbeatAt: timestamp,
      processId: null,
      projectId,
      reason,
      restartCount: currentComponent?.restartCount ?? 0,
      scope: "project",
      startedAt: currentComponent?.startedAt ?? null,
      status,
    })

    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: timestamp,
      componentId: component.componentId,
      details,
      lastHeartbeatAt: timestamp,
      projectId,
      reason,
      status,
    })

    const runtime = this.runtimeRegistry.ensureProjectRuntime(projectId)
    this.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: runtime.coordinatorId,
      coordinatorInstanceId: runtime.coordinatorInstanceId,
      lastHeartbeatAt: timestamp,
      projectId,
      restartCount: Math.max(runtime.restartCount, component.restartCount),
      startedAt: runtime.startedAt,
      status: "down",
    })

    if (forceEmit || previousStatus !== status) {
      this.emitThreadHealthChanges(
        projectId,
        this.threadService.listNonTerminalThreadIds(projectId),
        status,
        reason,
        timestamp,
      )
    }
  }

  private flushSnapshot(projectId: ProjectId): void {
    const state = this.getOrCreateSession(projectId)

    if (!state.handle || !state.coordinatorSnapshot) {
      return
    }

    const message =
      state.lastHelloPid === state.handle.pid
        ? {
            kind: "coordinator_snapshot",
            payload: state.coordinatorSnapshot,
          }
        : {
            kind: "hello",
            payload: {
              cadence: {
                active_ms: WATCHDOG_ACTIVE_CADENCE_MS,
                idle_ms: WATCHDOG_IDLE_CADENCE_MS,
                stuck_threshold_ms: WATCHDOG_STUCK_THRESHOLD_MS,
                suspect_threshold_ms: WATCHDOG_SUSPECT_THRESHOLD_MS,
              },
              coordinator_snapshot: state.coordinatorSnapshot,
              project_id: projectId,
              protocol_version: "1.0" as const,
            },
          }

    state.handle.writeLine(JSON.stringify(message))
    state.lastHelloPid = state.handle.pid
  }

  private buildWatchdogSpec(
    projectId: ProjectId,
    rootPath: string,
  ): SupervisedProcessSpec {
    return {
      args: [...process.execArgv, this.helperPath],
      command: process.execPath,
      componentType: "watchdog",
      cwd: rootPath,
      details: this.buildRuntimeDetails(projectId, rootPath),
      env: {
        ULTRA_PROJECT_ID: projectId,
      },
      projectId,
      scope: "project",
    }
  }

  private buildRuntimeDetails(
    projectId: ProjectId,
    cwd: string,
  ): RuntimeDetails {
    return {
      args: [...process.execArgv, this.helperPath],
      command: process.execPath,
      cwd,
      helperPath: this.helperPath,
      projectId,
    }
  }

  private buildProbeDetails(
    probe: Pick<
      WatchdogProbeResult,
      "active_thread_ids" | "checked_at" | "probe_state" | "reason"
    >,
    snapshot: WatchdogCoordinatorSnapshot | null,
    heartbeatAgeMs: number | null,
  ): RuntimeDetails {
    return {
      ...(snapshot
        ? {
            activeAgentCount: snapshot.active_agent_count,
            coordinatorInstanceId: snapshot.coordinator_instance_id,
            coordinatorStatus: snapshot.status,
          }
        : {}),
      activeThreadIds: probe.active_thread_ids,
      checkedAt: probe.checked_at,
      heartbeatAgeMs,
      probeState: probe.probe_state,
      reason: probe.reason,
    }
  }

  private deriveProjectRuntimeStatus(
    projectId: ProjectId,
    watchHealth: WatchdogHealth,
  ): string {
    if (watchHealth === "down") {
      return "down"
    }

    if (watchHealth === "degraded") {
      return "degraded"
    }

    const state = this.getOrCreateSession(projectId)
    const snapshot = state.coordinatorSnapshot
    if (snapshot) {
      return snapshot.status
    }

    return this.runtimeRegistry.ensureProjectRuntime(projectId).status
  }

  private emitThreadHealthChanges(
    projectId: ProjectId,
    threadIds: string[],
    watchHealth: WatchdogHealth,
    reason: string | null,
    occurredAt: string,
  ): void {
    const uniqueThreadIds = [...new Set(threadIds)]

    for (const threadId of uniqueThreadIds) {
      this.threadService.appendProjectedEvent({
        actorId: projectId,
        actorType: "watchdog",
        eventType: "thread.health_changed",
        occurredAt,
        payload: {
          reason,
          watch_health: watchHealth,
        },
        projectId,
        source: "ultra.watchdog",
        threadId,
      })
    }
  }

  private markUnavailable(
    projectId: ProjectId,
    reason: string,
    forceEmit = false,
  ): RuntimeComponentSnapshot {
    this.handleHelperFailure(projectId, reason, forceEmit)
    return (
      this.runtimeRegistry.getProjectRuntimeComponent(projectId, "watchdog") ??
      this.runtimeRegistry.upsertRuntimeComponent({
        componentType: "watchdog",
        details: {
          helperPath: this.helperPath,
          projectId,
          reason,
        },
        lastHeartbeatAt: this.now(),
        processId: null,
        projectId,
        reason,
        scope: "project",
        status: "down",
      })
    )
  }

  private getOrCreateSession(projectId: ProjectId): WatchdogSessionState {
    const existing = this.sessionsByProjectId.get(projectId)

    if (existing) {
      return existing
    }

    const state: WatchdogSessionState = {
      componentId: null,
      coordinatorSnapshot: null,
      detachExit: null,
      detachStderr: null,
      detachStdout: null,
      handle: null,
      lastHelloPid: null,
      skipNextExitFailure: false,
    }
    this.sessionsByProjectId.set(projectId, state)
    return state
  }

  private computeHeartbeatAgeMs(
    checkedAt: string,
    lastHeartbeatAt: string | null,
  ): number | null {
    if (!lastHeartbeatAt) {
      return null
    }

    const checkedAtMs = Date.parse(checkedAt)
    const lastHeartbeatAtMs = Date.parse(lastHeartbeatAt)

    if (Number.isNaN(checkedAtMs) || Number.isNaN(lastHeartbeatAtMs)) {
      return null
    }

    return Math.max(checkedAtMs - lastHeartbeatAtMs, 0)
  }
}
