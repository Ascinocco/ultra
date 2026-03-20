import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { ChatService } from "./chat-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  directory: string
  databasePath: string
  projectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-chat-service-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    directory,
    databasePath: join(directory, "ultra.db"),
    projectPath,
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

describe("ChatService", () => {
  it("creates a chat, initial session, and current session link", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )
    const project = projectService.open({ path: projectPath })

    const chat = chatService.create(project.id)
    const sessionRows = chatService.listSessions(chat.id)

    expect(chat.title).toBe("Untitled Chat")
    expect(chat.currentSessionId).toBe(sessionRows[0]?.id)
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0]).toMatchObject({
      chatId: chat.id,
      sequenceNumber: 1,
    })

    runtime.close()
  })

  it("lists chats pinned-first and updated descending", () => {
    const { databasePath, projectPath, directory } = createWorkspace()
    const secondProjectPath = join(directory, "project-two")
    mkdirSync(secondProjectPath)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T12:00:0${tick}Z`
    }
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    projectService.open({ path: secondProjectPath })

    const first = chatService.create(project.id)
    const second = chatService.create(project.id)
    chatService.pin(first.id)
    const chats = chatService.list(project.id)

    expect(chats.chats.map((chat) => chat.id)).toEqual([first.id, second.id])

    runtime.close()
  })

  it("persists rename, pin, archive, and restore across reload", () => {
    const { databasePath, projectPath } = createWorkspace()
    const firstRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(firstRuntime.database)
    const chatService = new ChatService(
      firstRuntime.database,
      () => "2026-03-15T12:00:00Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    chatService.rename(chat.id, "Plan chat")
    chatService.pin(chat.id)
    chatService.archive(chat.id)
    firstRuntime.close()

    const secondRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const secondService = new ChatService(
      secondRuntime.database,
      () => "2026-03-15T12:10:00Z",
    )
    const archived = secondService.get(chat.id)
    const restored = secondService.restore(chat.id)

    expect(archived.title).toBe("Plan chat")
    expect(archived.isPinned).toBe(true)
    expect(archived.status).toBe("archived")
    expect(restored.status).toBe("active")
    expect(restored.archivedAt).toBeNull()

    secondRuntime.close()
  })

  it("returns not_found for unknown chat ids", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ChatService(runtime.database)

    expect(() => service.get("chat_missing")).toThrow(/Chat not found/)

    runtime.close()
  })

  it("rejects empty rename input and exposes internal read helpers", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    expect(() => service.rename(chat.id, "   ")).toThrow(/must not be empty/)
    expect(service.listMessages(chat.id)).toEqual([])
    expect(service.listThreadRefs(chat.id)).toEqual([])
    expect(service.listChatRefs(chat.id)).toEqual([])

    runtime.close()
  })

  it("publishes appended messages to chat subscribers and supports unsubscribe", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)
    const received: string[] = []

    const unsubscribe = service.subscribeToMessages(chat.id, (message) => {
      received.push(message.id)
    })

    const first = service.appendMessage({
      chatId: chat.id,
      role: "user",
      messageType: "user_text",
      contentMarkdown: "First",
    })

    unsubscribe()

    service.appendMessage({
      chatId: chat.id,
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Second",
    })

    expect(received).toEqual([first.id])

    runtime.close()
  })

  it("updates runtime config, trims fields, and persists changes across reload", () => {
    const { databasePath, projectPath } = createWorkspace()
    const firstRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(firstRuntime.database)
    const service = new ChatService(
      firstRuntime.database,
      () => "2026-03-15T12:15:00Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    const updated = service.updateRuntimeConfig(chat.id, {
      provider: "claude",
      model: "  sonnet  ",
      thinkingLevel: "  medium  ",
      permissionLevel: "full_access",
    })

    expect(updated).toMatchObject({
      provider: "claude",
      model: "sonnet",
      thinkingLevel: "medium",
      permissionLevel: "full_access",
    })

    firstRuntime.close()

    const secondRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const secondService = new ChatService(secondRuntime.database)
    const reloaded = secondService.get(chat.id)

    expect(reloaded).toMatchObject({
      provider: "claude",
      model: "sonnet",
      thinkingLevel: "medium",
      permissionLevel: "full_access",
    })

    secondRuntime.close()
  })

  it("rejects empty model and thinking level runtime updates", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    expect(() =>
      service.updateRuntimeConfig(chat.id, {
        provider: "codex",
        model: "   ",
        thinkingLevel: "default",
        permissionLevel: "supervised",
      }),
    ).toThrow(/Chat model must not be empty/)

    expect(() =>
      service.updateRuntimeConfig(chat.id, {
        provider: "codex",
        model: "gpt-5.4",
        thinkingLevel: "   ",
        permissionLevel: "supervised",
      }),
    ).toThrow(/Chat thinking level must not be empty/)

    runtime.close()
  })

  it("records explicit plan and spec approval messages in chat order", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    const planApproval = service.approvePlan(chat.id)
    const specApproval = service.approveSpecs(chat.id)
    const messages = service.listMessages(chat.id)

    expect(planApproval.messageType).toBe("plan_approval")
    expect(specApproval.messageType).toBe("spec_approval")
    expect(messages.map((message) => message.messageType)).toEqual([
      "plan_approval",
      "spec_approval",
    ])

    runtime.close()
  })

  it("rejects spec approval before a plan approval exists", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    expect(() => service.approveSpecs(chat.id)).toThrow(
      /Plan approval is required/,
    )

    runtime.close()
  })

  it("requires a new plan approval before allowing another spec approval", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    service.approvePlan(chat.id)
    service.approveSpecs(chat.id)

    expect(() => service.approveSpecs(chat.id)).toThrow(
      /already approved for the latest approved plan/,
    )

    runtime.close()
  })

  it("requires explicit approval ordering before confirming start work", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    expect(() => service.confirmStartWork(chat.id)).toThrow(
      /Plan and spec approvals are required/,
    )

    service.approvePlan(chat.id)
    service.approveSpecs(chat.id)
    const startRequest = service.confirmStartWork(chat.id, {
      threadTitle: "Thread title",
      threadSummary: "Thread summary",
    })

    expect(startRequest.messageType).toBe("thread_start_request")
    expect(() => service.confirmStartWork(chat.id)).toThrow(
      /already confirmed for the latest approved specs/,
    )

    runtime.close()
  })

  it("returns workspaceDescription as null for new chats", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-19T12:00:00Z",
    )
    const project = projectService.open({ path: projectPath })

    const chat = chatService.create(project.id)
    expect(chat.workspaceDescription).toBeNull()

    runtime.close()
  })

  it("returns workspaceDescription after update", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-19T12:00:00Z",
    )
    const project = projectService.open({ path: projectPath })

    const chat = chatService.create(project.id)
    chatService.updateWorkspaceDescription(
      chat.id,
      "ULR-93: Fixing archived chat persistence",
    )
    const updated = chatService.get(chat.id)
    expect(updated.workspaceDescription).toBe(
      "ULR-93: Fixing archived chat persistence",
    )

    runtime.close()
  })

  describe("deriveTurnStatus", () => {
    function setupChatWithTurn(
      databasePath: string,
      projectPath: string,
      turnStatus: "queued" | "running" | "succeeded" | "failed" | "canceled",
    ) {
      const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
      const projectService = new ProjectService(runtime.database)
      const chatService = new ChatService(
        runtime.database,
        () => "2026-03-19T12:00:00Z",
      )
      const project = projectService.open({ path: projectPath })
      const chat = chatService.create(project.id)

      // Insert a user message (required FK for user_message_id)
      const messageId = `chat_msg_test_${turnStatus}`
      runtime.database
        .prepare(
          `INSERT INTO chat_messages (id, chat_id, session_id, role, message_type, content_markdown, structured_payload_json, provider_message_id, created_at)
           VALUES (?, ?, ?, 'user', 'user_text', 'hello', NULL, NULL, '2026-03-19T12:00:00Z')`,
        )
        .run(messageId, chat.id, chat.currentSessionId)

      // Insert a chat_turn row
      const turnId = `turn_test_${turnStatus}`
      runtime.database
        .prepare(
          `INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'claude', 'sonnet', '2026-03-19T12:00:00Z', '2026-03-19T12:00:00Z')`,
        )
        .run(turnId, chat.id, chat.currentSessionId, messageId, turnStatus)

      return { runtime, chatService, chat }
    }

    it("returns null when no turns exist", () => {
      const { databasePath, projectPath } = createWorkspace()
      const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
      const projectService = new ProjectService(runtime.database)
      const chatService = new ChatService(
        runtime.database,
        () => "2026-03-19T12:00:00Z",
      )
      const project = projectService.open({ path: projectPath })
      const chat = chatService.create(project.id)

      expect(chatService.deriveTurnStatus(chat.id)).toBeNull()

      runtime.close()
    })

    it("returns 'running' when a turn is queued", () => {
      const { databasePath, projectPath } = createWorkspace()
      const { runtime, chatService, chat } = setupChatWithTurn(
        databasePath,
        projectPath,
        "queued",
      )

      expect(chatService.deriveTurnStatus(chat.id)).toBe("running")

      runtime.close()
    })

    it("returns 'running' when a turn is running", () => {
      const { databasePath, projectPath } = createWorkspace()
      const { runtime, chatService, chat } = setupChatWithTurn(
        databasePath,
        projectPath,
        "running",
      )

      expect(chatService.deriveTurnStatus(chat.id)).toBe("running")

      runtime.close()
    })

    it("returns 'waiting_for_input' when last turn succeeded", () => {
      const { databasePath, projectPath } = createWorkspace()
      const { runtime, chatService, chat } = setupChatWithTurn(
        databasePath,
        projectPath,
        "succeeded",
      )

      expect(chatService.deriveTurnStatus(chat.id)).toBe("waiting_for_input")

      runtime.close()
    })

    it("returns 'waiting_for_input' when last turn was canceled", () => {
      const { databasePath, projectPath } = createWorkspace()
      const { runtime, chatService, chat } = setupChatWithTurn(
        databasePath,
        projectPath,
        "canceled",
      )

      expect(chatService.deriveTurnStatus(chat.id)).toBe("waiting_for_input")

      runtime.close()
    })

    it("returns 'error' when last turn failed", () => {
      const { databasePath, projectPath } = createWorkspace()
      const { runtime, chatService, chat } = setupChatWithTurn(
        databasePath,
        projectPath,
        "failed",
      )

      expect(chatService.deriveTurnStatus(chat.id)).toBe("error")

      runtime.close()
    })

    it("returns 'running' even when previous turn failed (active turn takes priority)", () => {
      const { databasePath, projectPath } = createWorkspace()
      const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
      const projectService = new ProjectService(runtime.database)
      const chatService = new ChatService(
        runtime.database,
        () => "2026-03-19T12:00:00Z",
      )
      const project = projectService.open({ path: projectPath })
      const chat = chatService.create(project.id)

      // Insert a failed turn (older)
      const failedMsgId = "chat_msg_test_failed_priority"
      runtime.database
        .prepare(
          `INSERT INTO chat_messages (id, chat_id, session_id, role, message_type, content_markdown, structured_payload_json, provider_message_id, created_at)
           VALUES (?, ?, ?, 'user', 'user_text', 'first', NULL, NULL, '2026-03-19T11:59:00Z')`,
        )
        .run(failedMsgId, chat.id, chat.currentSessionId)

      runtime.database
        .prepare(
          `INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at)
           VALUES ('turn_failed_priority', ?, ?, ?, 'failed', 'claude', 'sonnet', '2026-03-19T11:59:00Z', '2026-03-19T11:59:30Z')`,
        )
        .run(chat.id, chat.currentSessionId, failedMsgId)

      // Insert an active (running) turn (newer)
      const runningMsgId = "chat_msg_test_running_priority"
      runtime.database
        .prepare(
          `INSERT INTO chat_messages (id, chat_id, session_id, role, message_type, content_markdown, structured_payload_json, provider_message_id, created_at)
           VALUES (?, ?, ?, 'user', 'user_text', 'second', NULL, NULL, '2026-03-19T12:00:00Z')`,
        )
        .run(runningMsgId, chat.id, chat.currentSessionId)

      runtime.database
        .prepare(
          `INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at)
           VALUES ('turn_running_priority', ?, ?, ?, 'running', 'claude', 'sonnet', '2026-03-19T12:00:00Z', '2026-03-19T12:00:00Z')`,
        )
        .run(chat.id, chat.currentSessionId, runningMsgId)

      expect(chatService.deriveTurnStatus(chat.id)).toBe("running")

      runtime.close()
    })

    it("reflects turn status through get() and list()", () => {
      const { databasePath, projectPath } = createWorkspace()
      const { runtime, chatService, chat } = setupChatWithTurn(
        databasePath,
        projectPath,
        "failed",
      )
      const project = chatService.get(chat.id)

      expect(project.turnStatus).toBe("error")

      // list() also returns derived turn status
      const projectRow = runtime.database
        .prepare("SELECT id FROM projects WHERE id = ?")
        .get(chat.projectId) as { id: string }
      const listed = chatService.list(projectRow.id)
      const listedChat = listed.chats.find((c) => c.id === chat.id)
      expect(listedChat?.turnStatus).toBe("error")

      runtime.close()
    })
  })
})
