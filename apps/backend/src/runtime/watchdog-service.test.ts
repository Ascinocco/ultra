import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatService } from "../chats/chat-service.js"
import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "../sandboxes/sandbox-service.js"
import { ThreadService } from "../threads/thread-service.js"
import { CoordinatorService } from "./coordinator-service.js"
import {
  FakeSupervisedProcessAdapter,
  type FakeSupervisedProcessHandle,
} from "./fake-supervised-process-adapter.js"
import { RuntimePersistenceService } from "./runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime-registry.js"
import { RuntimeSupervisor } from "./runtime-supervisor.js"
import { WatchdogService } from "./watchdog-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): { databasePath: string; projectPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ultra-watchdog-service-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    databasePath: join(directory, "ultra.db"),
    projectPath,
  }
}

function seedApprovalMessages(chatService: ChatService, chatId: string) {
  return {
    planApproval: chatService.appendMessage({
      chatId,
      contentMarkdown: "approve plan",
      messageType: "plan_approval",
      role: "user",
    }),
    specApproval: chatService.appendMessage({
      chatId,
      contentMarkdown: "approve specs",
      messageType: "spec_approval",
      role: "user",
    }),
    startRequest: chatService.appendMessage({
      chatId,
      contentMarkdown: "start work",
      messageType: "thread_start_request",
      role: "user",
    }),
  }
}

function parseRequestId(line: string): string {
  return (JSON.parse(line) as { request_id: string }).request_id
}

type RuntimeFixture = {
  adapter: FakeSupervisedProcessAdapter
  chatService: ChatService
  coordinatorHandle: FakeSupervisedProcessHandle
  coordinatorService: CoordinatorService
  project: ReturnType<ProjectService["open"]>
  runtime: ReturnType<typeof bootstrapDatabase>
  runtimeRegistry: RuntimeRegistry
  thread: ReturnType<ThreadService["startThread"]>
  threadService: ThreadService
  watchdogHandle: FakeSupervisedProcessHandle
  watchdogService: WatchdogService
}

function createRuntimeFixture(): RuntimeFixture {
  const { databasePath, projectPath } = createWorkspace()
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const projectService = new ProjectService(runtime.database)
  const chatService = new ChatService(runtime.database)
  const runtimeRegistry = new RuntimeRegistry(
    new RuntimePersistenceService(runtime.database),
  )
  runtimeRegistry.hydrate()
  const adapter = new FakeSupervisedProcessAdapter()
  const runtimeSupervisor = new RuntimeSupervisor(runtimeRegistry, adapter)
  const threadService = new ThreadService(runtime.database)
  const sandboxService = new SandboxService(
    new SandboxPersistenceService(runtime.database),
  )
  const watchdogService = new WatchdogService(
    runtimeSupervisor,
    runtimeRegistry,
    projectService,
    threadService,
    () => "2026-03-16T22:00:00.000Z",
  )
  const coordinatorService = new CoordinatorService(
    runtimeSupervisor,
    runtimeRegistry,
    projectService,
    sandboxService,
    threadService,
    () => "2026-03-16T22:00:00.000Z",
    undefined,
    watchdogService,
  )

  threadService.setCoordinatorDispatchHandler({
    sendThreadMessage: (input) => coordinatorService.sendThreadMessage(input),
    startThread: (input) => coordinatorService.startThread(input),
  })

  const project = projectService.open({ path: projectPath })
  const chat = chatService.create(project.id)
  const approvals = seedApprovalMessages(chatService, chat.id)
  const thread = threadService.startThread({
    chat_id: chat.id,
    plan_approval_message_id: approvals.planApproval.id,
    spec_approval_message_id: approvals.specApproval.id,
    spec_refs: [],
    start_request_message_id: approvals.startRequest.id,
    summary: "Runtime watchdog thread",
    ticket_refs: [],
    title: "Runtime watchdog thread",
  })

  const coordinatorHandle = adapter.spawns[0]?.handle
  if (!coordinatorHandle) {
    throw new Error("Coordinator handle was not created.")
  }

  coordinatorHandle.emitStdoutLine(
    JSON.stringify({
      kind: "response",
      ok: true,
      protocol_version: "1.0",
      request_id: parseRequestId(coordinatorHandle.writtenLines[0] ?? ""),
      result: {
        accepted_protocol_version: "1.0",
        capabilities: {
          supports_project_pause: true,
          supports_project_resume: true,
          supports_thread_messages: true,
          supports_thread_retry: true,
        },
        coordinator_id: `coord_${project.id}`,
        coordinator_instance_id: "coord_instance_1",
        coordinator_version: "0.1.0",
      },
    }),
  )

  const watchdogHandle = adapter.spawns[1]?.handle
  if (!watchdogHandle) {
    throw new Error("Watchdog handle was not created after coordinator hello.")
  }

  return {
    adapter,
    chatService,
    coordinatorHandle,
    coordinatorService,
    project,
    runtime,
    runtimeRegistry,
    thread,
    threadService,
    watchdogHandle,
    watchdogService,
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { force: true, recursive: true })
    }
  }
})

describe("WatchdogService", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("creates and reuses one project-scoped watchdog helper entrypoint", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const runtimeRegistry = new RuntimeRegistry(
      new RuntimePersistenceService(runtime.database),
    )
    runtimeRegistry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const runtimeSupervisor = new RuntimeSupervisor(runtimeRegistry, adapter)
    const threadService = new ThreadService(runtime.database)
    const watchdogService = new WatchdogService(
      runtimeSupervisor,
      runtimeRegistry,
      projectService,
      threadService,
    )
    const project = projectService.open({ path: projectPath })

    const first = watchdogService.ensureRunning(project.id)
    const second = watchdogService.ensureRunning(project.id)

    expect(first.componentId).toBe(second.componentId)
    expect(first.projectId).toBe(project.id)
    expect(adapter.spawns).toHaveLength(1)
    expect(adapter.spawns[0]?.spec.componentType).toBe("watchdog")
    expect(adapter.spawns[0]?.spec.command).toBe(process.execPath)
    expect(adapter.spawns[0]?.spec.args.at(-1)).toContain("watchdog-helper")
    expect(adapter.spawns[0]?.spec.args).not.toContain("watch")

    runtime.close()
  })

  it("forwards coordinator snapshots to the watchdog helper over NDJSON stdin", () => {
    const fixture = createRuntimeFixture()

    expect(
      fixture.watchdogHandle.writtenLines.some((line) =>
        line.includes('"kind":"hello"'),
      ),
    ).toBe(true)

    fixture.coordinatorHandle.emitStdoutLine(
      JSON.stringify({
        coordinator_id: `coord_${fixture.project.id}`,
        coordinator_instance_id: "coord_instance_1",
        event_type: "heartbeat",
        kind: "event",
        occurred_at: "2026-03-16T22:01:00.000Z",
        payload: {
          active_agent_count: 2,
          active_thread_ids: [fixture.thread.thread.id],
          last_heartbeat_at: "2026-03-16T22:01:00.000Z",
          status: "running",
        },
        project_id: fixture.project.id,
        sequence_number: 1,
      }),
    )

    expect(
      fixture.watchdogHandle.writtenLines.some((line) =>
        line.includes('"kind":"coordinator_snapshot"'),
      ),
    ).toBe(true)

    fixture.runtime.close()
  })

  it("projects suspect, stuck, and recovery probes into runtime health and thread watch health", () => {
    const fixture = createRuntimeFixture()
    const statusUpdates: string[] = []
    fixture.runtimeRegistry.subscribeToComponentUpdates((component) => {
      if (component.componentType === "watchdog") {
        statusUpdates.push(component.status)
      }
    })

    fixture.watchdogHandle.emitStdoutLine(
      JSON.stringify({
        kind: "probe_result",
        payload: {
          active_thread_ids: [fixture.thread.thread.id],
          checked_at: "2026-03-16T22:02:00.000Z",
          component_status: "degraded",
          last_heartbeat_at: "2026-03-16T22:00:20.000Z",
          probe_state: "suspect",
          project_id: fixture.project.id,
          reason: "Coordinator heartbeat exceeded the suspect threshold.",
        },
      }),
    )

    expect(
      fixture.runtimeRegistry.getProjectRuntimeComponent(
        fixture.project.id,
        "watchdog",
      )?.status,
    ).toBe("degraded")
    expect(
      fixture.threadService.getThread(fixture.thread.thread.id).thread
        .watchHealth,
    ).toBe("degraded")
    expect(
      fixture.threadService.getThread(fixture.thread.thread.id).thread
        .executionState,
    ).toBe("queued")

    fixture.watchdogHandle.emitStdoutLine(
      JSON.stringify({
        kind: "probe_result",
        payload: {
          active_thread_ids: [fixture.thread.thread.id],
          checked_at: "2026-03-16T22:03:10.000Z",
          component_status: "down",
          last_heartbeat_at: "2026-03-16T22:00:00.000Z",
          probe_state: "stuck",
          project_id: fixture.project.id,
          reason: "Coordinator heartbeat exceeded the stuck threshold.",
        },
      }),
    )

    expect(
      fixture.runtimeRegistry.getProjectRuntimeComponent(
        fixture.project.id,
        "watchdog",
      )?.status,
    ).toBe("down")
    expect(
      fixture.threadService.getThread(fixture.thread.thread.id).thread
        .watchHealth,
    ).toBe("down")

    fixture.watchdogHandle.emitStdoutLine(
      JSON.stringify({
        kind: "probe_result",
        payload: {
          active_thread_ids: [fixture.thread.thread.id],
          checked_at: "2026-03-16T22:03:30.000Z",
          component_status: "healthy",
          last_heartbeat_at: "2026-03-16T22:03:20.000Z",
          probe_state: "idle",
          project_id: fixture.project.id,
          reason: null,
        },
      }),
    )

    expect(
      fixture.threadService.getThread(fixture.thread.thread.id).thread
        .watchHealth,
    ).toBe("healthy")
    expect(statusUpdates).toEqual(
      expect.arrayContaining(["degraded", "down", "healthy"]),
    )
    expect(
      fixture.threadService
        .getEvents(fixture.thread.thread.id)
        .events.filter((event) => event.eventType === "thread.health_changed"),
    ).toHaveLength(3)

    fixture.runtime.close()
  })

  it("marks the watchdog down when the coordinator becomes unavailable", () => {
    const fixture = createRuntimeFixture()

    fixture.coordinatorHandle.emitStderrLine("coordinator lost transport")

    expect(
      fixture.runtimeRegistry.getProjectRuntimeComponent(
        fixture.project.id,
        "watchdog",
      )?.status,
    ).toBe("down")
    expect(
      fixture.threadService.getThread(fixture.thread.thread.id).thread
        .watchHealth,
    ).toBe("down")

    fixture.runtime.close()
  })

  it("marks the watchdog down and emits visible health when the helper exits", async () => {
    const fixture = createRuntimeFixture()

    fixture.watchdogHandle.emitExit({
      code: 2,
      signal: null,
    })
    await Promise.resolve()

    expect(
      fixture.runtimeRegistry.getProjectRuntimeComponent(
        fixture.project.id,
        "watchdog",
      )?.status,
    ).toBe("down")
    expect(
      fixture.threadService.getThread(fixture.thread.thread.id).thread
        .watchHealth,
    ).toBe("down")
    expect(
      fixture.threadService
        .getEvents(fixture.thread.thread.id)
        .events.some(
          (event) =>
            event.eventType === "thread.health_changed" &&
            event.source === "ultra.watchdog",
        ),
    ).toBe(true)

    fixture.runtime.close()
  })
})
