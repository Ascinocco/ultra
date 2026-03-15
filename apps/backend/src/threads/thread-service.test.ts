import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"

import { afterEach, describe, expect, it } from "vitest"

import { ChatService } from "../chats/chat-service.js"
import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { ThreadService } from "./thread-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  projectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-thread-service-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    databasePath: join(directory, "ultra.db"),
    projectPath,
  }
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number }

  return row.count
}

function seedStartThreadMessages(chatService: ChatService, chatId: string) {
  const planApproval = chatService.appendMessage({
    chatId,
    role: "assistant",
    messageType: "plan_approval",
    contentMarkdown: "Plan approved",
  })
  const specApproval = chatService.appendMessage({
    chatId,
    role: "assistant",
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

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("ThreadService", () => {
  it("creates a thread, refs, and thread.created event from chats.start_thread", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const now = () => "2026-03-15T12:00:00Z"
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const messages = seedStartThreadMessages(chatService, chat.id)

    const detail = threadService.startThread({
      chat_id: chat.id,
      plan_approval_message_id: messages.planApproval.id,
      spec_approval_message_id: messages.specApproval.id,
      start_request_message_id: messages.startRequest.id,
      summary: "Build the thread foundation",
      spec_refs: [
        {
          spec_path: "docs/specs/thread-foundation.md",
          spec_slug: "thread-foundation",
        },
      ],
      ticket_refs: [
        {
          provider: "linear",
          external_id: "ULR-25",
          display_label: "ULR-25",
          url: "https://linear.app/example/issue/ULR-25",
          metadata_json: '{"team":"Ultra"}',
        },
      ],
    })

    expect(detail.thread).toMatchObject({
      projectId: project.id,
      sourceChatId: chat.id,
      title: "Untitled Chat",
      summary: "Build the thread foundation",
      executionState: "queued",
      reviewState: "not_ready",
      publishState: "not_requested",
      worktreeId: null,
      branchName: null,
      baseBranch: null,
      createdByMessageId: messages.startRequest.id,
      lastEventSequence: 1,
    })
    expect(detail.specRefs).toHaveLength(1)
    expect(detail.ticketRefs).toHaveLength(1)
    expect(countRows(runtime.database, "threads")).toBe(1)
    expect(countRows(runtime.database, "chat_thread_refs")).toBe(1)
    expect(countRows(runtime.database, "thread_specs")).toBe(1)
    expect(countRows(runtime.database, "thread_ticket_refs")).toBe(1)
    expect(countRows(runtime.database, "thread_events")).toBe(1)

    const events = threadService.getEvents(detail.thread.id).events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      threadId: detail.thread.id,
      sequenceNumber: 1,
      eventType: "thread.created",
      actorType: "chat",
      actorId: chat.id,
      source: "ultra.chat",
    })
    expect(events[0]?.payload).toMatchObject({
      creationSource: "start_thread",
      startRequestMessageId: messages.startRequest.id,
    })

    runtime.close()
  })

  it("returns the existing thread for a duplicate start_request_message_id", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const now = () => "2026-03-15T12:05:00Z"
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const messages = seedStartThreadMessages(chatService, chat.id)

    const first = threadService.startThread({
      chat_id: chat.id,
      plan_approval_message_id: messages.planApproval.id,
      spec_approval_message_id: messages.specApproval.id,
      start_request_message_id: messages.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })
    const second = threadService.startThread({
      chat_id: chat.id,
      plan_approval_message_id: messages.planApproval.id,
      spec_approval_message_id: messages.specApproval.id,
      start_request_message_id: messages.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })

    expect(second.thread.id).toBe(first.thread.id)
    expect(countRows(runtime.database, "threads")).toBe(1)
    expect(countRows(runtime.database, "thread_events")).toBe(1)

    runtime.close()
  })

  it("rejects start_thread when the source chat is missing", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const threadService = new ThreadService(runtime.database)

    expect(() =>
      threadService.startThread({
        chat_id: "chat_missing",
        plan_approval_message_id: "chat_msg_plan",
        spec_approval_message_id: "chat_msg_spec",
        start_request_message_id: "chat_msg_start",
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/Chat not found/)

    runtime.close()
  })

  it("rejects start_thread for missing or wrong-type approval messages", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const now = () => "2026-03-15T12:10:00Z"
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const wrongTypeMessage = chatService.appendMessage({
      chatId: chat.id,
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Not an approval",
    })
    const startRequest = chatService.appendMessage({
      chatId: chat.id,
      role: "user",
      messageType: "thread_start_request",
      contentMarkdown: "Start work",
    })

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        plan_approval_message_id: "chat_msg_missing",
        spec_approval_message_id: wrongTypeMessage.id,
        start_request_message_id: startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/Missing plan approval message/)

    const messages = seedStartThreadMessages(chatService, chat.id)

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        plan_approval_message_id: wrongTypeMessage.id,
        spec_approval_message_id: messages.specApproval.id,
        start_request_message_id: messages.startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/must have message_type plan_approval/)

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        plan_approval_message_id: messages.planApproval.id,
        spec_approval_message_id: messages.specApproval.id,
        start_request_message_id: wrongTypeMessage.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/must have message_type thread_start_request/)

    runtime.close()
  })

  it("rejects start_thread when approval messages belong to another chat", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const now = () => "2026-03-15T12:15:00Z"
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const firstChat = chatService.create(project.id)
    const secondChat = chatService.create(project.id)
    const firstMessages = seedStartThreadMessages(chatService, firstChat.id)
    const secondMessages = seedStartThreadMessages(chatService, secondChat.id)

    expect(() =>
      threadService.startThread({
        chat_id: firstChat.id,
        plan_approval_message_id: secondMessages.planApproval.id,
        spec_approval_message_id: firstMessages.specApproval.id,
        start_request_message_id: firstMessages.startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/does not belong to chat/)

    runtime.close()
  })

  it("creates a promoted thread and carries selected message/checkpoint refs", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T12:20:0${tick}Z`
    }
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const messages = seedStartThreadMessages(chatService, chat.id)
    const selectedMessage = chatService.appendMessage({
      chatId: chat.id,
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Carry this context",
    })
    const checkpointId = chatService.createActionCheckpoint({
      chatId: chat.id,
      actionType: "edit",
      affectedPaths: ["apps/backend/src/threads/thread-service.ts"],
      artifactRefsJson: JSON.stringify(["artifact://diff-1"]),
    })

    const detail = threadService.promoteWorkToThread({
      chat_id: chat.id,
      start_request_message_id: messages.startRequest.id,
      plan_approval_message_id: messages.planApproval.id,
      spec_approval_message_id: messages.specApproval.id,
      promotion_summary: "Carry the current chat work into a durable thread",
      spec_refs: [
        {
          spec_path: "docs/specs/thread-promotion.md",
          spec_slug: "thread-promotion",
        },
      ],
      ticket_refs: [],
      selected_message_ids: [selectedMessage.id],
      selected_checkpoint_ids: [checkpointId],
      carried_seed_refs: ["ultra-44d3"],
    })

    expect(detail.thread.summary).toBe(
      "Carry the current chat work into a durable thread",
    )
    expect(countRows(runtime.database, "threads")).toBe(1)

    const event = threadService.getEvents(detail.thread.id).events[0]
    expect(event?.payload).toMatchObject({
      creationSource: "promotion",
      promotionSummary: "Carry the current chat work into a durable thread",
      carriedMessageIds: [selectedMessage.id],
      carriedCheckpointIds: [checkpointId],
      carriedArtifactRefs: ["artifact://diff-1"],
      carriedSeedRefs: ["ultra-44d3"],
    })

    runtime.close()
  })

  it("rejects promotion when selected messages or checkpoints are invalid", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const now = () => "2026-03-15T12:25:00Z"
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const firstChat = chatService.create(project.id)
    const secondChat = chatService.create(project.id)
    const firstMessages = seedStartThreadMessages(chatService, firstChat.id)
    const secondMessage = chatService.appendMessage({
      chatId: secondChat.id,
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Wrong chat",
    })
    const secondCheckpointId = chatService.createActionCheckpoint({
      chatId: secondChat.id,
      actionType: "run",
      affectedPaths: ["README.md"],
    })

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        start_request_message_id: firstMessages.startRequest.id,
        promotion_summary: "Promote work",
        spec_refs: [],
        ticket_refs: [],
        selected_message_ids: ["chat_msg_missing"],
        selected_checkpoint_ids: [],
        carried_seed_refs: [],
      }),
    ).toThrow(/Selected message not found/)

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        start_request_message_id: firstMessages.startRequest.id,
        promotion_summary: "Promote work",
        spec_refs: [],
        ticket_refs: [],
        selected_message_ids: [secondMessage.id],
        selected_checkpoint_ids: [],
        carried_seed_refs: [],
      }),
    ).toThrow(/does not belong to chat/)

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        start_request_message_id: firstMessages.startRequest.id,
        promotion_summary: "Promote work",
        spec_refs: [],
        ticket_refs: [],
        selected_message_ids: [],
        selected_checkpoint_ids: ["chat_checkpoint_missing"],
        carried_seed_refs: [],
      }),
    ).toThrow(/Selected checkpoint not found/)

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        start_request_message_id: firstMessages.startRequest.id,
        promotion_summary: "Promote work",
        spec_refs: [],
        ticket_refs: [],
        selected_message_ids: [],
        selected_checkpoint_ids: [secondCheckpointId],
        carried_seed_refs: [],
      }),
    ).toThrow(/does not belong to chat/)

    expect(() =>
      threadService.promoteWorkToThread({
        chat_id: firstChat.id,
        start_request_message_id: firstMessages.startRequest.id,
        promotion_summary: "   ",
        spec_refs: [],
        ticket_refs: [],
        selected_message_ids: [],
        selected_checkpoint_ids: [],
        carried_seed_refs: [],
      }),
    ).toThrow(/Promotion summary is required/)

    runtime.close()
  })

  it("lists by project and chat, and replays later events", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T12:30:0${tick}Z`
    }
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const firstChat = chatService.create(project.id)
    const secondChat = chatService.create(project.id)
    const firstMessages = seedStartThreadMessages(chatService, firstChat.id)
    const secondMessages = seedStartThreadMessages(chatService, secondChat.id)
    const firstThread = threadService.startThread({
      chat_id: firstChat.id,
      plan_approval_message_id: firstMessages.planApproval.id,
      spec_approval_message_id: firstMessages.specApproval.id,
      start_request_message_id: firstMessages.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })
    const secondThread = threadService.startThread({
      chat_id: secondChat.id,
      plan_approval_message_id: secondMessages.planApproval.id,
      spec_approval_message_id: secondMessages.specApproval.id,
      start_request_message_id: secondMessages.startRequest.id,
      spec_refs: [],
      ticket_refs: [],
    })
    const extraEvent = threadService.eventService.append({
      projectId: project.id,
      threadId: secondThread.thread.id,
      eventType: "thread.summary_updated",
      actorType: "system",
      source: "ultra.thread",
      payload: {
        summary: "Updated summary",
      },
    })
    threadService.projectionService.applyEvent(extraEvent)

    const projectThreads = threadService.listByProject(project.id)
    const chatThreads = threadService.listByChat(firstChat.id)
    const threadDetail = threadService.getThread(firstThread.thread.id)
    const laterEvents = threadService.getEvents(secondThread.thread.id, 1)

    expect(projectThreads.threads.map((thread) => thread.id)).toEqual([
      secondThread.thread.id,
      firstThread.thread.id,
    ])
    expect(chatThreads.threads.map((thread) => thread.id)).toEqual([
      firstThread.thread.id,
    ])
    expect(threadDetail.thread.id).toBe(firstThread.thread.id)
    expect(laterEvents.events).toHaveLength(1)
    expect(laterEvents.events[0]?.sequenceNumber).toBe(2)

    runtime.close()
  })

  it("rolls back thread creation when event append fails", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const now = () => "2026-03-15T12:35:00Z"
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const messages = seedStartThreadMessages(chatService, chat.id)

    ;(
      threadService as unknown as { eventService: { append: () => never } }
    ).eventService = {
      append: () => {
        throw new Error("event append failed")
      },
    }

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        plan_approval_message_id: messages.planApproval.id,
        spec_approval_message_id: messages.specApproval.id,
        start_request_message_id: messages.startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      }),
    ).toThrow(/event append failed/)
    expect(countRows(runtime.database, "threads")).toBe(0)
    expect(countRows(runtime.database, "chat_thread_refs")).toBe(0)
    expect(countRows(runtime.database, "thread_events")).toBe(0)

    runtime.close()
  })

  it("rolls back thread creation when spec inserts fail", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const now = () => "2026-03-15T12:40:00Z"
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const threadService = new ThreadService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const messages = seedStartThreadMessages(chatService, chat.id)

    expect(() =>
      threadService.startThread({
        chat_id: chat.id,
        plan_approval_message_id: messages.planApproval.id,
        spec_approval_message_id: messages.specApproval.id,
        start_request_message_id: messages.startRequest.id,
        spec_refs: [
          {
            spec_path: "docs/specs/thread-foundation.md",
            spec_slug: "thread-foundation",
          },
          {
            spec_path: "docs/specs/thread-foundation.md",
            spec_slug: "thread-foundation-duplicate",
          },
        ],
        ticket_refs: [],
      }),
    ).toThrow()
    expect(countRows(runtime.database, "threads")).toBe(0)
    expect(countRows(runtime.database, "thread_specs")).toBe(0)
    expect(countRows(runtime.database, "thread_events")).toBe(0)

    runtime.close()
  })
})
