import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { type ChatMessageSnapshot, ChatService } from "../chats/chat-service.js"
import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { ThreadService } from "./thread-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): { databasePath: string; projectPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ultra-thread-service-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
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

function seedApprovalMessages(
  chatService: ChatService,
  chatId: string,
): {
  planApproval: ChatMessageSnapshot
  specApproval: ChatMessageSnapshot
  startRequest: ChatMessageSnapshot
} {
  const planApproval = chatService.appendMessage({
    chatId,
    role: "user",
    messageType: "plan_approval",
    contentMarkdown: "Plan approved",
  })
  const specApproval = chatService.appendMessage({
    chatId,
    role: "user",
    messageType: "spec_approval",
    contentMarkdown: "Specs approved",
  })
  const startRequest = chatService.appendMessage({
    chatId,
    role: "user",
    messageType: "thread_start_request",
    contentMarkdown: "Start work",
  })

  return {
    planApproval,
    specApproval,
    startRequest,
  }
}

describe("ThreadService", () => {
  it("creates a thread, thread refs, and a thread.created event", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:00:00Z",
    )
    const threadService = new ThreadService(
      runtime.database,
      () => "2026-03-16T00:00:01Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)

    const result = threadService.startThread({
      chat_id: chat.id,
      title: "Implement search flow",
      summary: "Create the first thread",
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      start_request_message_id: approvals.startRequest.id,
      spec_refs: [
        {
          spec_path: "docs/specs/search.md",
          spec_slug: "search",
        },
      ],
      ticket_refs: [
        {
          provider: "linear",
          external_id: "ULR-25",
          display_label: "ULR-25",
          url: "https://linear.app/ulra-agentic-ide/issue/ULR-25",
          metadata: { team: "Ultra" },
        },
      ],
    })

    const chatThreadRefCount = runtime.database
      .prepare(
        "SELECT COUNT(*) AS count FROM chat_thread_refs WHERE chat_id = ? AND thread_id = ?",
      )
      .get(chat.id, result.thread.id) as { count: number }
    const persistedEvent = runtime.database
      .prepare(
        "SELECT event_type, sequence_number FROM thread_events WHERE thread_id = ?",
      )
      .get(result.thread.id) as
      | {
          event_type: string
          sequence_number: number
        }
      | undefined

    expect(result.thread.sourceChatId).toBe(chat.id)
    expect(result.thread.executionState).toBe("queued")
    expect(result.thread.worktreeId).toBeNull()
    expect(result.specRefs).toEqual([
      expect.objectContaining({ specPath: "docs/specs/search.md" }),
    ])
    expect(result.ticketRefs).toEqual([
      expect.objectContaining({ externalId: "ULR-25" }),
    ])
    expect(chatThreadRefCount.count).toBe(1)
    expect(persistedEvent).toEqual({
      event_type: "thread.created",
      sequence_number: 1,
    })

    runtime.close()
  })

  it("returns the existing thread when the same start_request_message_id is reused", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:05:00Z",
    )
    const threadService = new ThreadService(
      runtime.database,
      () => "2026-03-16T00:05:01Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)

    const first = threadService.startThread({
      chat_id: chat.id,
      title: "Thread one",
      summary: null,
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      start_request_message_id: approvals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })
    const second = threadService.startThread({
      chat_id: chat.id,
      title: "Thread one duplicate",
      summary: "Should not be used",
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      start_request_message_id: approvals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })

    const threadCount = runtime.database
      .prepare("SELECT COUNT(*) AS count FROM threads")
      .get() as { count: number }

    expect(first.thread.id).toBe(second.thread.id)
    expect(threadCount.count).toBe(1)

    runtime.close()
  })

  it("rejects missing or wrong-type approval messages", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:10:00Z",
    )
    const threadService = new ThreadService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const userText = chatService.appendMessage({
      chatId: chat.id,
      role: "user",
      messageType: "user_text",
      contentMarkdown: "hello",
    })
    const approvals = seedApprovalMessages(chatService, chat.id)

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        title: "Broken thread",
        summary: null,
        plan_approval_message_id: userText.id,
        spec_approval_message_id: approvals.specApproval.id,
        start_request_message_id: approvals.startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/must have type plan_approval/)

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        title: "Missing thread",
        summary: null,
        plan_approval_message_id: approvals.planApproval.id,
        spec_approval_message_id: approvals.specApproval.id,
        start_request_message_id: "msg_missing",
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/Chat message not found/)

    runtime.close()
  })

  it("rejects approval messages from another chat", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:15:00Z",
    )
    const threadService = new ThreadService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const firstChat = chatService.create(project.id)
    const secondChat = chatService.create(project.id)
    const firstApprovals = seedApprovalMessages(chatService, firstChat.id)
    const secondApprovals = seedApprovalMessages(chatService, secondChat.id)

    expect(() =>
      threadService.startThread({
        chat_id: firstChat.id,
        title: "Cross chat",
        summary: null,
        plan_approval_message_id: secondApprovals.planApproval.id,
        spec_approval_message_id: firstApprovals.specApproval.id,
        start_request_message_id: firstApprovals.startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/does not belong to chat/)

    runtime.close()
  })

  it("promotes selected chat messages and checkpoints into a thread.created event payload", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:20:00Z",
    )
    const threadService = new ThreadService(
      runtime.database,
      () => "2026-03-16T00:20:01Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)
    const assistantMessage = chatService.appendMessage({
      chatId: chat.id,
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Here is the implementation summary.",
    })
    const checkpointId = chatService.createActionCheckpoint({
      chatId: chat.id,
      actionType: "edit",
      affectedPaths: ["src/thread.ts"],
      resultSummary: "Edited thread service",
    })

    const result = threadService.promoteWorkToThread({
      chat_id: chat.id,
      title: "Promoted thread",
      summary: "Promotion path",
      start_request_message_id: approvals.startRequest.id,
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      promotion_summary: "Carry selected work into a durable thread.",
      selected_message_ids: [assistantMessage.id],
      selected_checkpoint_ids: [checkpointId],
      carried_artifact_refs: ["artifact_1"],
      carried_seed_refs: ["seed_1"],
      spec_refs: [],
      ticket_refs: [],
    })
    const event = threadService.getEvents(result.thread.id).events[0]

    expect(event.eventType).toBe("thread.created")
    expect(event.payload).toEqual(
      expect.objectContaining({
        creationSource: "promotion",
        promotionSummary: "Carry selected work into a durable thread.",
        carriedMessageIds: [assistantMessage.id],
        carriedCheckpointIds: [checkpointId],
        carriedArtifactRefs: ["artifact_1"],
        carriedSeedRefs: ["seed_1"],
      }),
    )

    runtime.close()
  })

  it("rejects nonexistent or cross-chat selected messages and checkpoints during promotion", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:25:00Z",
    )
    const threadService = new ThreadService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const firstChat = chatService.create(project.id)
    const secondChat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, firstChat.id)
    const secondMessage = chatService.appendMessage({
      chatId: secondChat.id,
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Other chat",
    })
    const secondCheckpoint = chatService.createActionCheckpoint({
      chatId: secondChat.id,
      actionType: "command",
      affectedPaths: ["src/other.ts"],
      resultSummary: "Ran command",
    })

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        title: "Broken promotion",
        summary: null,
        start_request_message_id: approvals.startRequest.id,
        plan_approval_message_id: null,
        spec_approval_message_id: null,
        promotion_summary: "promote",
        selected_message_ids: ["msg_missing"],
        selected_checkpoint_ids: [],
        carried_artifact_refs: [],
        carried_seed_refs: [],
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/Chat message not found/)

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        title: "Broken promotion",
        summary: null,
        start_request_message_id: approvals.startRequest.id,
        plan_approval_message_id: null,
        spec_approval_message_id: null,
        promotion_summary: "promote",
        selected_message_ids: [secondMessage.id],
        selected_checkpoint_ids: [],
        carried_artifact_refs: [],
        carried_seed_refs: [],
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/does not belong to chat/)

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        title: "Broken promotion",
        summary: null,
        start_request_message_id: approvals.startRequest.id,
        plan_approval_message_id: null,
        spec_approval_message_id: null,
        promotion_summary: "promote",
        selected_message_ids: [],
        selected_checkpoint_ids: [secondCheckpoint],
        carried_artifact_refs: [],
        carried_seed_refs: [],
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/does not belong to chat/)

    runtime.close()
  })

  it("rejects missing promotion summaries", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:30:00Z",
    )
    const threadService = new ThreadService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: chat.id,
        title: "No summary",
        summary: null,
        start_request_message_id: approvals.startRequest.id,
        plan_approval_message_id: null,
        spec_approval_message_id: null,
        promotion_summary: "   ",
        selected_message_ids: [],
        selected_checkpoint_ids: [],
        carried_artifact_refs: [],
        carried_seed_refs: [],
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/Promotion summary is required/)

    runtime.close()
  })

  it("lists threads by project/chat and replays events from a sequence", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:35:00Z",
    )
    let tick = 0
    const threadService = new ThreadService(runtime.database, () => {
      tick += 1
      return `2026-03-16T00:35:0${tick}Z`
    })
    const project = projectService.open({ path: projectPath })
    const firstChat = chatService.create(project.id)
    const secondChat = chatService.create(project.id)
    const firstApprovals = seedApprovalMessages(chatService, firstChat.id)
    const secondApprovals = seedApprovalMessages(chatService, secondChat.id)

    const first = threadService.startThread({
      chat_id: firstChat.id,
      title: "Older thread",
      summary: null,
      plan_approval_message_id: firstApprovals.planApproval.id,
      spec_approval_message_id: firstApprovals.specApproval.id,
      start_request_message_id: firstApprovals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })
    const second = threadService.startThread({
      chat_id: secondChat.id,
      title: "Newer thread",
      summary: null,
      plan_approval_message_id: secondApprovals.planApproval.id,
      spec_approval_message_id: secondApprovals.specApproval.id,
      start_request_message_id: secondApprovals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })

    const projectThreads = threadService.listByProject(project.id)
    const chatThreads = threadService.listByChat(firstChat.id)
    const fullEvents = threadService.getEvents(first.thread.id)
    const replayed = threadService.getEvents(first.thread.id, 1)

    expect(projectThreads.threads.map((thread) => thread.id)).toEqual([
      second.thread.id,
      first.thread.id,
    ])
    expect(chatThreads.threads.map((thread) => thread.id)).toEqual([
      first.thread.id,
    ])
    expect(fullEvents.events).toHaveLength(1)
    expect(replayed.events).toEqual([])

    runtime.close()
  })

  it("rolls back thread creation if event append fails", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:40:00Z",
    )
    const threadService = new ThreadService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)

    ;(
      threadService as unknown as {
        eventService: { appendEvent: () => never }
      }
    ).eventService = {
      appendEvent: () => {
        throw new Error("event append failed")
      },
    }

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        title: "Rollback thread",
        summary: null,
        plan_approval_message_id: approvals.planApproval.id,
        spec_approval_message_id: approvals.specApproval.id,
        start_request_message_id: approvals.startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/event append failed/)

    const threadCount = runtime.database
      .prepare("SELECT COUNT(*) AS count FROM threads")
      .get() as { count: number }

    expect(threadCount.count).toBe(0)

    runtime.close()
  })

  it("sendMessage persists a user message and getMessages retrieves it", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:00:00Z",
    )
    const threadService = new ThreadService(
      runtime.database,
      () => "2026-03-16T00:00:01Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)
    const thread = threadService.startThread({
      chat_id: chat.id,
      title: "Test thread",
      summary: null,
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      start_request_message_id: approvals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })

    const sent = threadService.sendMessage({
      thread_id: thread.thread.id,
      content: "How is progress?",
    })

    expect(sent.message.role).toBe("user")
    expect(sent.message.messageType).toBe("text")
    expect(sent.message.content.text).toBe("How is progress?")
    expect(sent.message.threadId).toBe(thread.thread.id)

    const result = threadService.getMessages(thread.thread.id)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.id).toBe(sent.message.id)

    runtime.close()
  })

  it("getMessages returns messages in chronological order", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:00:00Z",
    )
    const threadService = new ThreadService(
      runtime.database,
      () => "2026-03-16T00:00:01Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)
    const thread = threadService.startThread({
      chat_id: chat.id,
      title: "Test thread",
      summary: null,
      plan_approval_message_id: approvals.planApproval.id,
      spec_approval_message_id: approvals.specApproval.id,
      start_request_message_id: approvals.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })

    threadService.sendMessage({
      thread_id: thread.thread.id,
      content: "First message",
    })
    threadService.sendMessage({
      thread_id: thread.thread.id,
      content: "Second message",
    })

    const result = threadService.getMessages(thread.thread.id)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]?.content.text).toBe("First message")
    expect(result.messages[1]?.content.text).toBe("Second message")

    runtime.close()
  })

  it("getMessages throws for non-existent thread", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const threadService = new ThreadService(
      runtime.database,
      () => "2026-03-16T00:00:01Z",
    )
    expect(() => threadService.getMessages("nonexistent")).toThrow()

    runtime.close()
  })

  it("sendMessage throws for non-existent thread", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const threadService = new ThreadService(
      runtime.database,
      () => "2026-03-16T00:00:01Z",
    )
    expect(() =>
      threadService.sendMessage({
        thread_id: "nonexistent",
        content: "hello",
      }),
    ).toThrow()

    runtime.close()
  })

  it("rolls back thread creation if spec inserts fail", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-16T00:45:00Z",
    )
    const threadService = new ThreadService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const approvals = seedApprovalMessages(chatService, chat.id)

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        title: "Duplicate specs",
        summary: null,
        plan_approval_message_id: approvals.planApproval.id,
        spec_approval_message_id: approvals.specApproval.id,
        start_request_message_id: approvals.startRequest.id,
        spec_refs: [
          {
            spec_path: "docs/specs/dup.md",
            spec_slug: "dup",
          },
          {
            spec_path: "docs/specs/dup.md",
            spec_slug: "dup",
          },
        ],
        ticket_refs: [],
      }),
    ).toThrow()

    const threadCount = runtime.database
      .prepare("SELECT COUNT(*) AS count FROM threads")
      .get() as { count: number }

    expect(threadCount.count).toBe(0)

    runtime.close()
  })
})
