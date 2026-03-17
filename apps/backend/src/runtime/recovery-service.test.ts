import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

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
import { RecoveryService } from "./recovery-service.js"
import { RuntimePersistenceService } from "./runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime-registry.js"
import { RuntimeSupervisor } from "./runtime-supervisor.js"
import { WatchService } from "./watch-service.js"
import { WatchdogService } from "./watchdog-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): { databasePath: string; projectPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ultra-recovery-service-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    databasePath: join(directory, "ultra.db"),
    projectPath,
  }
}

class AutoHelloProcessAdapter extends FakeSupervisedProcessAdapter {
  constructor(private readonly ignoredProjectIds = new Set<string>()) {
    super()
  }

  ignoreProject(projectId: string): void {
    this.ignoredProjectIds.add(projectId)
  }

  override spawn(spec: Parameters<FakeSupervisedProcessAdapter["spawn"]>[0]) {
    const handle = super.spawn(spec) as FakeSupervisedProcessHandle
    const originalWriteLine = handle.writeLine.bind(handle)

    handle.writeLine = (line: string) => {
      originalWriteLine(line)

      if (spec.componentType !== "coordinator" || !spec.projectId) {
        return
      }

      const payload = JSON.parse(line) as {
        command?: string
        request_id?: string
      }

      if (
        payload.command !== "hello" ||
        !payload.request_id ||
        this.ignoredProjectIds.has(spec.projectId)
      ) {
        return
      }

      queueMicrotask(() => {
        handle.emitStdoutLine(
          JSON.stringify({
            kind: "response",
            ok: true,
            protocol_version: "1.0",
            request_id: payload.request_id,
            result: {
              accepted_protocol_version: "1.0",
              capabilities: {
                supports_project_pause: true,
                supports_project_resume: true,
                supports_thread_messages: true,
                supports_thread_retry: true,
              },
              coordinator_id: `coord_${spec.projectId}`,
              coordinator_instance_id: `coord_instance_${handle.pid}`,
              coordinator_version: "0.1.0",
            },
          }),
        )
      })
    }

    return handle
  }
}

type SeededThread = ReturnType<ThreadService["startThread"]>

type RecoveryFixture = {
  adapter: AutoHelloProcessAdapter
  coordinatorService: CoordinatorService
  databasePath: string
  project: ReturnType<ProjectService["open"]>
  recoveryService: RecoveryService
  runtime: ReturnType<typeof bootstrapDatabase>
  runtimeRegistry: RuntimeRegistry
  runtimeSupervisor: RuntimeSupervisor
  threadService: ThreadService
  watchService: WatchService
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

function seedThread(
  projectId: string,
  threadService: ThreadService,
  chatService: ChatService,
  title = "Recovered thread",
): SeededThread {
  const chat = chatService.create(projectId)
  const approvals = seedApprovalMessages(chatService, chat.id)

  return threadService.startThread({
    chat_id: chat.id,
    plan_approval_message_id: approvals.planApproval.id,
    spec_approval_message_id: approvals.specApproval.id,
    spec_refs: [
      {
        spec_path: "docs/specs/recovery.md",
        spec_slug: "recovery",
      },
    ],
    start_request_message_id: approvals.startRequest.id,
    summary: "Recover runtime ownership after restart",
    ticket_refs: [
      {
        display_label: "ULR-43",
        external_id: "ULR-43",
        metadata: { team: "Ultra" },
        provider: "linear",
        url: "https://linear.app/ultra/issue/ULR-43",
      },
    ],
    title,
  })
}

function createRecoveryFixture(options?: {
  helloTimeoutMs?: number
  ignoredHelloProjectIds?: string[]
}): RecoveryFixture {
  const { databasePath, projectPath } = createWorkspace()
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const projectService = new ProjectService(runtime.database)
  const project = projectService.open({ path: projectPath })
  const threadService = new ThreadService(runtime.database)
  const runtimeRegistry = new RuntimeRegistry(
    new RuntimePersistenceService(runtime.database),
  )
  runtimeRegistry.hydrate()
  const adapter = new AutoHelloProcessAdapter(
    new Set(options?.ignoredHelloProjectIds ?? []),
  )
  const runtimeSupervisor = new RuntimeSupervisor(runtimeRegistry, adapter)
  const sandboxService = new SandboxService(
    new SandboxPersistenceService(runtime.database),
  )
  const watchdogService = new WatchdogService(
    runtimeSupervisor,
    runtimeRegistry,
    projectService,
    threadService,
  )
  const coordinatorService = new CoordinatorService(
    runtimeSupervisor,
    runtimeRegistry,
    projectService,
    sandboxService,
    threadService,
    undefined,
    options?.helloTimeoutMs,
    watchdogService,
  )
  const watchService = new WatchService(
    runtimeSupervisor,
    runtimeRegistry,
    databasePath,
  )
  const recoveryService = new RecoveryService(
    projectService,
    threadService,
    runtimeRegistry,
    coordinatorService,
    watchdogService,
    watchService,
  )

  return {
    adapter,
    coordinatorService,
    databasePath,
    project,
    recoveryService,
    runtime,
    runtimeRegistry,
    runtimeSupervisor,
    threadService,
    watchService,
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

describe("RecoveryService", () => {
  it("recreates ov watch, the project coordinator, and the watchdog for active work", async () => {
    const fixture = createRecoveryFixture()
    const chatService = new ChatService(fixture.runtime.database)
    const thread = seedThread(
      fixture.project.id,
      fixture.threadService,
      chatService,
    )

    fixture.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: `coord_${fixture.project.id}`,
      coordinatorInstanceId: "coord_instance_old",
      lastHeartbeatAt: "2026-03-16T23:00:00.000Z",
      projectId: fixture.project.id,
      restartCount: 1,
      startedAt: "2026-03-16T22:59:00.000Z",
      status: "running",
    })
    fixture.runtimeRegistry.upsertRuntimeComponent({
      componentId: "runtime_component_coord_existing",
      componentType: "coordinator",
      details: {
        coordinatorId: `coord_${fixture.project.id}`,
        coordinatorInstanceId: "coord_instance_old",
      },
      lastHeartbeatAt: "2026-03-16T23:00:00.000Z",
      processId: null,
      projectId: fixture.project.id,
      reason: "Backend restarted.",
      restartCount: 1,
      scope: "project",
      startedAt: "2026-03-16T22:59:00.000Z",
      status: "down",
    })

    fixture.runtimeSupervisor.hydrate()
    fixture.watchService.ensureRunning()
    await fixture.recoveryService.recover()

    expect(
      fixture.adapter.spawns.filter(
        (spawn) => spawn.spec.componentType === "ov_watch",
      ),
    ).toHaveLength(1)
    expect(
      fixture.adapter.spawns.filter(
        (spawn) => spawn.spec.componentType === "coordinator",
      ),
    ).toHaveLength(1)
    expect(
      fixture.adapter.spawns.filter(
        (spawn) => spawn.spec.componentType === "watchdog",
      ),
    ).toHaveLength(1)

    const coordinatorHandle = fixture.adapter.spawns.find(
      (spawn) => spawn.spec.componentType === "coordinator",
    )?.handle
    expect(
      coordinatorHandle?.writtenLines.some(
        (line) =>
          line.includes(`"thread_id":"${thread.thread.id}"`) &&
          line.includes('"command":"start_thread"'),
      ),
    ).toBe(true)

    const events = fixture.threadService.getEvents(thread.thread.id).events
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "thread.coordinator_restarted",
        "thread.recovered",
      ]),
    )

    expect(
      fixture.threadService.getThread(thread.thread.id).thread.backendHealth,
    ).toBe("healthy")

    const threadCount = fixture.runtime.database
      .prepare("SELECT COUNT(*) AS count FROM threads")
      .get() as { count: number }
    expect(threadCount.count).toBe(1)

    fixture.runtime.close()
  })

  it("includes projects with non-terminal threads even when runtime rows are stale or missing", async () => {
    const fixture = createRecoveryFixture()
    const chatService = new ChatService(fixture.runtime.database)
    const thread = seedThread(
      fixture.project.id,
      fixture.threadService,
      chatService,
      "Recover without runtime rows",
    )

    fixture.runtimeSupervisor.hydrate()
    fixture.watchService.ensureRunning()
    await fixture.recoveryService.recover()

    expect(
      fixture.adapter.spawns.some(
        (spawn) =>
          spawn.spec.componentType === "coordinator" &&
          spawn.spec.projectId === fixture.project.id,
      ),
    ).toBe(true)
    expect(
      fixture.threadService
        .getEvents(thread.thread.id)
        .events.some((event) => event.eventType === "thread.recovered"),
    ).toBe(true)

    fixture.runtime.close()
  })

  it("does not eagerly recover projects whose threads are already terminal", async () => {
    const fixture = createRecoveryFixture()
    const chatService = new ChatService(fixture.runtime.database)
    const thread = seedThread(
      fixture.project.id,
      fixture.threadService,
      chatService,
      "Completed thread",
    )

    fixture.threadService.appendProjectedEvent({
      actorType: "backend",
      eventType: "thread.completed",
      payload: {
        summary: "Done",
      },
      projectId: fixture.project.id,
      source: "ultra.runtime",
      threadId: thread.thread.id,
    })

    fixture.runtimeSupervisor.hydrate()
    fixture.watchService.ensureRunning()
    await fixture.recoveryService.recover()

    expect(
      fixture.adapter.spawns.filter(
        (spawn) => spawn.spec.componentType === "coordinator",
      ),
    ).toHaveLength(0)
    expect(
      fixture.adapter.spawns.filter(
        (spawn) => spawn.spec.componentType === "watchdog",
      ),
    ).toHaveLength(0)

    fixture.runtime.close()
  })

  it("restores paused project runtime after replaying recoverable threads", async () => {
    const fixture = createRecoveryFixture()
    const chatService = new ChatService(fixture.runtime.database)
    const thread = seedThread(
      fixture.project.id,
      fixture.threadService,
      chatService,
      "Paused recovery thread",
    )

    fixture.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: `coord_${fixture.project.id}`,
      coordinatorInstanceId: "coord_instance_old",
      lastHeartbeatAt: "2026-03-16T23:10:00.000Z",
      projectId: fixture.project.id,
      restartCount: 2,
      startedAt: "2026-03-16T23:00:00.000Z",
      status: "paused",
    })

    fixture.runtimeSupervisor.hydrate()
    fixture.watchService.ensureRunning()
    await fixture.recoveryService.recover()

    const coordinatorHandle = fixture.adapter.spawns.find(
      (spawn) => spawn.spec.componentType === "coordinator",
    )?.handle
    const startIndex =
      coordinatorHandle?.writtenLines.findIndex((line) =>
        line.includes('"command":"start_thread"'),
      ) ?? -1
    const pauseIndex =
      coordinatorHandle?.writtenLines.findIndex((line) =>
        line.includes('"command":"pause_project_runtime"'),
      ) ?? -1

    expect(startIndex).toBeGreaterThanOrEqual(0)
    expect(pauseIndex).toBeGreaterThan(startIndex)
    expect(
      fixture.threadService
        .getEvents(thread.thread.id)
        .events.some((event) => event.eventType === "thread.recovered"),
    ).toBe(true)

    fixture.runtime.close()
  })

  it("emits recovery_failed and leaves visible degraded runtime state when coordinator recovery times out", async () => {
    const fixture = createRecoveryFixture({
      helloTimeoutMs: 10,
    })
    fixture.adapter.ignoreProject(fixture.project.id)
    const chatService = new ChatService(fixture.runtime.database)
    const thread = seedThread(
      fixture.project.id,
      fixture.threadService,
      chatService,
      "Failed recovery thread",
    )

    fixture.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: `coord_${fixture.project.id}`,
      coordinatorInstanceId: "coord_instance_old",
      lastHeartbeatAt: "2026-03-16T23:20:00.000Z",
      projectId: fixture.project.id,
      restartCount: 1,
      startedAt: "2026-03-16T23:00:00.000Z",
      status: "running",
    })

    fixture.runtimeSupervisor.hydrate()
    fixture.watchService.ensureRunning()
    await fixture.recoveryService.recover()

    const events = fixture.threadService.getEvents(thread.thread.id).events
    expect(events.map((event) => event.eventType)).toContain(
      "thread.recovery_failed",
    )
    expect(
      fixture.threadService.getThread(thread.thread.id).thread.backendHealth,
    ).toBe("degraded")
    expect(
      ["degraded", "down"].includes(
        fixture.runtimeRegistry.getProjectRuntimeSnapshot(fixture.project.id)
          .status,
      ),
    ).toBe(true)

    fixture.runtime.close()
  })
})
