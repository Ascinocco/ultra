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
import { FakeSupervisedProcessAdapter } from "./fake-supervised-process-adapter.js"
import { RuntimePersistenceService } from "./runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime-registry.js"
import { RuntimeSupervisor } from "./runtime-supervisor.js"

const temporaryDirectories: string[] = []

function createWorkspace(): { databasePath: string; projectPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ultra-coordinator-service-"))
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
      role: "user",
      messageType: "plan_approval",
      contentMarkdown: "approve plan",
    }),
    specApproval: chatService.appendMessage({
      chatId,
      role: "user",
      messageType: "spec_approval",
      contentMarkdown: "approve specs",
    }),
    startRequest: chatService.appendMessage({
      chatId,
      role: "user",
      messageType: "thread_start_request",
      contentMarkdown: "start work",
    }),
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("CoordinatorService", () => {
  it("creates and reuses one project-scoped coordinator component", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const runtimeRegistry = new RuntimeRegistry(
      new RuntimePersistenceService(runtime.database),
    )
    runtimeRegistry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const runtimeSupervisor = new RuntimeSupervisor(runtimeRegistry, adapter)
    const sandboxService = new SandboxService(
      new SandboxPersistenceService(runtime.database),
    )
    const threadService = new ThreadService(runtime.database)
    const coordinatorService = new CoordinatorService(
      runtimeSupervisor,
      runtimeRegistry,
      projectService,
      sandboxService,
      threadService,
      () => "2026-03-16T20:00:00.000Z",
    )
    const project = projectService.open({ path: projectPath })

    const first = coordinatorService.ensureRunning(project.id)
    const second = coordinatorService.ensureRunning(project.id)

    expect(first.componentId).toBe(second.componentId)
    expect(adapter.spawns).toHaveLength(1)
    expect(adapter.spawns[0]?.spec.componentType).toBe("coordinator")
    expect(adapter.spawns[0]?.handle.writtenLines[0]).toContain(
      '"command":"hello"',
    )

    runtime.close()
  })

  it("routes start-thread and runtime commands through the coordinator transport", () => {
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
    const sandboxService = new SandboxService(
      new SandboxPersistenceService(runtime.database),
    )
    const threadService = new ThreadService(runtime.database)
    const coordinatorService = new CoordinatorService(
      runtimeSupervisor,
      runtimeRegistry,
      projectService,
      sandboxService,
      threadService,
      () => "2026-03-16T20:00:00.000Z",
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
      title: "Coordinator thread",
      summary: "Created through coordinator service",
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      start_request_message_id: approvals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })

    const coordinatorHandle = adapter.spawns[0]?.handle
    expect(
      coordinatorHandle?.writtenLines.some((line) =>
        line.includes('"command":"start_thread"'),
      ),
    ).toBe(true)

    const sendMessage = threadService.sendMessage({
      project_id: project.id,
      thread_id: thread.thread.id,
      content: "Please rerun tests.",
      attachments: [],
    })
    const retry = coordinatorService.retryThread({
      project_id: project.id,
      thread_id: thread.thread.id,
    })
    const pause = coordinatorService.pauseProjectRuntime({
      project_id: project.id,
    })
    const resume = coordinatorService.resumeProjectRuntime({
      project_id: project.id,
    })

    expect(sendMessage.message.content.text).toBe("Please rerun tests.")
    expect(retry.accepted).toBe(true)
    expect(pause.accepted).toBe(true)
    expect(resume.accepted).toBe(true)
    expect(
      coordinatorHandle?.writtenLines.some((line) =>
        line.includes('"command":"send_thread_message"'),
      ),
    ).toBe(true)
    expect(
      coordinatorHandle?.writtenLines.some((line) =>
        line.includes('"command":"retry_thread"'),
      ),
    ).toBe(true)
    expect(
      coordinatorHandle?.writtenLines.some((line) =>
        line.includes('"command":"pause_project_runtime"'),
      ),
    ).toBe(true)
    expect(
      coordinatorHandle?.writtenLines.some((line) =>
        line.includes('"command":"resume_project_runtime"'),
      ),
    ).toBe(true)

    runtime.close()
  })

  it("projects coordinator events into runtime state and thread messages", () => {
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
    const sandboxService = new SandboxService(
      new SandboxPersistenceService(runtime.database),
    )
    const threadService = new ThreadService(runtime.database)
    const coordinatorService = new CoordinatorService(
      runtimeSupervisor,
      runtimeRegistry,
      projectService,
      sandboxService,
      threadService,
      () => "2026-03-16T20:00:00.000Z",
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
      title: "Projected thread",
      summary: "Created through coordinator service",
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      start_request_message_id: approvals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })
    const coordinatorHandle = adapter.spawns[0]?.handle

    coordinatorHandle?.emitStdoutLine(
      JSON.stringify({
        kind: "response",
        protocol_version: "1.0",
        request_id: coordinatorHandle.writtenLines[0]
          ? JSON.parse(coordinatorHandle.writtenLines[0] as string).request_id
          : "coord_req_hello",
        ok: true,
        result: {
          accepted_protocol_version: "1.0",
          coordinator_id: `coord_${project.id}`,
          coordinator_instance_id: "coord_instance_1",
          coordinator_version: "0.1.0",
          capabilities: {
            supports_project_pause: true,
            supports_project_resume: true,
            supports_thread_messages: true,
            supports_thread_retry: true,
          },
        },
      }),
    )
    coordinatorHandle?.emitStdoutLine(
      JSON.stringify({
        kind: "event",
        protocol_version: "1.0",
        event_id: "coord_evt_1",
        sequence_number: 1,
        event_type: "heartbeat",
        project_id: project.id,
        coordinator_id: `coord_${project.id}`,
        coordinator_instance_id: "coord_instance_1",
        occurred_at: "2026-03-16T20:01:00.000Z",
        payload: {
          status: "healthy",
          last_heartbeat_at: "2026-03-16T20:01:00.000Z",
          active_thread_ids: [thread.thread.id],
          active_agent_count: 1,
        },
      }),
    )
    coordinatorHandle?.emitStdoutLine(
      JSON.stringify({
        kind: "event",
        protocol_version: "1.0",
        event_id: "coord_evt_2",
        sequence_number: 2,
        event_type: "thread_message_emitted",
        project_id: project.id,
        coordinator_id: `coord_${project.id}`,
        coordinator_instance_id: "coord_instance_1",
        thread_id: thread.thread.id,
        occurred_at: "2026-03-16T20:02:00.000Z",
        payload: {
          message_id: "thread_msg_assistant_1",
          role: "assistant",
          message_type: "assistant_text",
          content_markdown: "Tests are rerunning now.",
          attachments: [],
        },
      }),
    )

    const projectRuntime = runtimeRegistry.getProjectRuntimeSnapshot(project.id)
    const component = runtimeRegistry.getProjectRuntimeComponent(
      project.id,
      "coordinator",
    )
    const messages = threadService.getMessages(thread.thread.id)

    expect(projectRuntime.coordinatorInstanceId).toBe("coord_instance_1")
    expect(component?.status).toBe("healthy")
    expect(messages.messages).toEqual([
      expect.objectContaining({
        role: "coordinator",
        content: {
          text: "Tests are rerunning now.",
        },
      }),
    ])

    runtime.close()
  })
})
