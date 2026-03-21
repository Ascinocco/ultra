import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type {
  ChatsPromoteToThreadInput,
  ChatsPromoteWorkToThreadInput,
  ChatsStartThreadInput,
  ProjectId,
  ThreadCreatedEventPayload,
  ThreadDetailResult,
  ThreadExecutionState,
  ThreadId,
  ThreadMessageAttachment,
  ThreadMessageContent,
  ThreadMessageRole,
  ThreadMessageSnapshot,
  ThreadMessageType,
  ThreadPublishState,
  ThreadReviewState,
  ThreadSnapshot,
  ThreadSpecRefInput,
  ThreadSpecRefSnapshot,
  ThreadsGetEventsResult,
  ThreadsGetMessagesResult,
  ThreadsListResult,
  ThreadsSendMessageInput,
  ThreadsSendMessageResult,
  ThreadTicketRefInput,
  ThreadTicketRefSnapshot,
} from "@ultra/shared"

import type { ChatService } from "../chats/chat-service.js"
import { loadAttachments } from "../chats/attachment-storage.js"
import { IpcProtocolError } from "../ipc/errors.js"
import { ThreadEventService } from "./thread-event-service.js"
import { ThreadProjectionService } from "./thread-projection-service.js"

type ChatRow = {
  id: string
  project_id: string
}

type ThreadRow = {
  id: string
  project_id: string
  source_chat_id: string
  title: string
  summary: string | null
  execution_state: ThreadExecutionState
  review_state: ThreadReviewState
  publish_state: ThreadPublishState
  backend_health: string
  coordinator_health: string
  watch_health: string
  ov_project_id: string | null
  ov_coordinator_id: string | null
  ov_thread_key: string | null
  worktree_id: string | null
  branch_name: string | null
  base_branch: string | null
  latest_commit_sha: string | null
  pr_provider: string | null
  pr_number: string | null
  pr_url: string | null
  last_event_sequence: number
  restart_count: number
  failure_reason: string | null
  created_by_message_id: string | null
  created_at: string
  updated_at: string
  last_activity_at: string | null
  approved_at: string | null
  completed_at: string | null
}

type ThreadSpecRefRow = {
  thread_id: string
  spec_path: string
  spec_slug: string
  created_at: string
}

type ThreadTicketRefRow = {
  thread_id: string
  provider: string
  external_id: string
  display_label: string
  url: string | null
  metadata_json: string | null
  created_at: string
}

type ThreadMessageRow = {
  id: string
  thread_id: string
  role: string
  provider: string | null
  model: string | null
  message_type: string
  content_json: string
  artifact_refs_json: string | null
  created_at: string
}

type CoordinatorDispatchHandler = {
  sendThreadMessage: (input: {
    attachments: ThreadMessageAttachment[]
    contentMarkdown: string
    messageId: string
    projectId: ProjectId
    threadId: ThreadId
  }) => void
  startThread: (input: {
    input: ChatsStartThreadInput
    thread: ThreadDetailResult
  }) => void
}

function readThreadRow(result: unknown): ThreadRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ThreadRow
}

function readChatRow(result: unknown): ChatRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ChatRow
}

function parseMetadata(
  metadataJson: string | null,
): Record<string, unknown> | null {
  if (!metadataJson) {
    return null
  }

  const parsed = JSON.parse(metadataJson) as unknown

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Thread ticket metadata JSON must decode to an object.")
  }

  return parsed as Record<string, unknown>
}

function mapThreadRow(row: ThreadRow): ThreadSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceChatId: row.source_chat_id,
    title: row.title,
    summary: row.summary,
    executionState: row.execution_state,
    reviewState: row.review_state,
    publishState: row.publish_state,
    backendHealth: row.backend_health,
    coordinatorHealth: row.coordinator_health,
    watchHealth: row.watch_health,
    ovProjectId: row.ov_project_id,
    ovCoordinatorId: row.ov_coordinator_id,
    ovThreadKey: row.ov_thread_key,
    worktreeId: row.worktree_id,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    latestCommitSha: row.latest_commit_sha,
    prProvider: row.pr_provider,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    lastEventSequence: row.last_event_sequence,
    restartCount: row.restart_count,
    failureReason: row.failure_reason,
    createdByMessageId: row.created_by_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    approvedAt: row.approved_at,
    completedAt: row.completed_at,
  }
}

function mapThreadSpecRefRow(row: ThreadSpecRefRow): ThreadSpecRefSnapshot {
  return {
    threadId: row.thread_id,
    specPath: row.spec_path,
    specSlug: row.spec_slug,
    createdAt: row.created_at,
  }
}

function mapThreadTicketRefRow(
  row: ThreadTicketRefRow,
): ThreadTicketRefSnapshot {
  return {
    threadId: row.thread_id,
    provider: row.provider,
    externalId: row.external_id,
    displayLabel: row.display_label,
    url: row.url,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  }
}

function readThreadMessageRow(result: unknown): ThreadMessageRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ThreadMessageRow
}

function parseThreadMessageContent(contentJson: string): ThreadMessageContent {
  const parsed = JSON.parse(contentJson) as unknown

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Thread message content JSON must decode to an object.")
  }

  const candidate = parsed as Record<string, unknown>

  return {
    text:
      typeof candidate.text === "string"
        ? candidate.text
        : typeof candidate.content_markdown === "string"
          ? candidate.content_markdown
          : "",
  }
}

function parseArtifactRefs(artifactRefsJson: string | null): string[] {
  if (!artifactRefsJson) {
    return []
  }

  const parsed = JSON.parse(artifactRefsJson) as unknown

  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : []
}

function mapThreadMessageRow(row: ThreadMessageRow): ThreadMessageSnapshot {
  const content = parseThreadMessageContent(row.content_json)

  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role as ThreadMessageRole,
    provider: row.provider,
    model: row.model,
    messageType: row.message_type as ThreadMessageType,
    content,
    artifactRefs: parseArtifactRefs(row.artifact_refs_json),
    createdAt: row.created_at,
  }
}

type CreateThreadRecordInput = {
  chatId: string
  projectId: ProjectId
  title: string
  summary?: string | null
  createdByMessageId: string
}

export class ThreadService {
  private readonly eventService: ThreadEventService

  private readonly projectionService: ThreadProjectionService

  private coordinatorDispatchHandler: CoordinatorDispatchHandler | null = null

  private readonly messageListenersByThreadId = new Map<
    ThreadId,
    Set<(message: ThreadMessageSnapshot) => void>
  >()

  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.eventService = new ThreadEventService(database, now)
    this.projectionService = new ThreadProjectionService(database)
  }

  setCoordinatorDispatchHandler(handler: CoordinatorDispatchHandler): void {
    this.coordinatorDispatchHandler = handler
  }

  startThread(input: ChatsStartThreadInput): ThreadDetailResult {
    if (!input.start_request_message_id) {
      throw new IpcProtocolError(
        "invalid_request",
        "Start request message is required to create a thread.",
      )
    }

    const existing = this.getThreadByCreatedByMessageId(
      input.start_request_message_id,
    )

    if (existing) {
      return this.getThread(existing.id)
    }

    const chat = this.assertChatExists(input.chat_id)
    const planApproval = this.assertChatMessageType(
      input.chat_id,
      input.plan_approval_message_id,
      "plan_approval",
    )
    const specApproval = this.assertChatMessageType(
      input.chat_id,
      input.spec_approval_message_id,
      "spec_approval",
    )
    const startRequest = this.assertChatMessageType(
      input.chat_id,
      input.start_request_message_id,
      "thread_start_request",
    )
    this.assertMessageSequence(
      [planApproval, "plan_approval"],
      [specApproval, "spec_approval"],
      [startRequest, "thread_start_request"],
    )

    const threadId = this.createThreadWithInitialEvent(
      {
        chatId: input.chat_id,
        projectId: chat.project_id,
        title: input.title,
        summary: input.summary ?? null,
        createdByMessageId: input.start_request_message_id,
      },
      input.spec_refs,
      input.ticket_refs,
      this.buildCreatedPayload({
        chatId: input.chat_id,
        title: input.title,
        summary: input.summary ?? null,
        specRefs: input.spec_refs,
        ticketRefs: input.ticket_refs,
        creationSource: "start_thread",
      }),
    )
    const thread = this.getThread(threadId)

    if (this.coordinatorDispatchHandler) {
      try {
        this.coordinatorDispatchHandler.startThread({ input, thread })
      } catch (error) {
        this.recordDispatchFailure(
          thread.thread.projectId,
          thread.thread.id,
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    return this.getThread(threadId)
  }

  promoteWorkToThread(
    input: ChatsPromoteWorkToThreadInput,
  ): ThreadDetailResult {
    if (!input.promotion_summary.trim()) {
      throw new IpcProtocolError(
        "invalid_request",
        "Promotion summary is required.",
      )
    }

    const existing = this.getThreadByCreatedByMessageId(
      input.start_request_message_id,
    )

    if (existing) {
      return this.getThread(existing.id)
    }

    const chat = this.assertChatExists(input.chat_id)

    const startRequest = this.assertChatMessageType(
      input.chat_id,
      input.start_request_message_id,
      "thread_start_request",
    )

    let planApproval:
      | {
          sequence_number: number
        }
      | undefined
    if (input.plan_approval_message_id) {
      planApproval = this.assertChatMessageType(
        input.chat_id,
        input.plan_approval_message_id,
        "plan_approval",
      )
    }

    let specApproval:
      | {
          sequence_number: number
        }
      | undefined
    if (input.spec_approval_message_id) {
      specApproval = this.assertChatMessageType(
        input.chat_id,
        input.spec_approval_message_id,
        "spec_approval",
      )
    }

    if (planApproval && specApproval) {
      this.assertMessageSequence(
        [planApproval, "plan_approval"],
        [specApproval, "spec_approval"],
      )
    }

    if (planApproval) {
      this.assertMessageSequence(
        [planApproval, "plan_approval"],
        [startRequest, "thread_start_request"],
      )
    }

    if (specApproval) {
      this.assertMessageSequence(
        [specApproval, "spec_approval"],
        [startRequest, "thread_start_request"],
      )
    }

    this.assertMessagesBelongToChat(input.chat_id, input.selected_message_ids)
    this.assertCheckpointsBelongToChat(
      input.chat_id,
      input.selected_checkpoint_ids,
    )

    const threadId = this.createThreadWithInitialEvent(
      {
        chatId: input.chat_id,
        projectId: chat.project_id,
        title: input.title,
        summary: input.summary ?? null,
        createdByMessageId: input.start_request_message_id,
      },
      input.spec_refs,
      input.ticket_refs,
      this.buildCreatedPayload({
        chatId: input.chat_id,
        title: input.title,
        summary: input.summary ?? null,
        specRefs: input.spec_refs,
        ticketRefs: input.ticket_refs,
        creationSource: "promotion",
        promotionSummary: input.promotion_summary,
        carriedMessageIds: input.selected_message_ids,
        carriedCheckpointIds: input.selected_checkpoint_ids,
        carriedArtifactRefs: input.carried_artifact_refs,
        carriedSeedRefs: input.carried_seed_refs,
      }),
    )

    return this.getThread(threadId)
  }

  promoteToThread(
    input: ChatsPromoteToThreadInput,
    chatService: ChatService,
  ): ThreadDetailResult {
    const chat = this.assertChatExists(input.chat_id)

    const contextMessages: Array<{
      id: string
      role: string
      messageType: string
      content: string | null
      attachments?: Array<{ type: string; name: string; media_type: string; data: string }>
    }> = []

    for (const messageId of input.context_message_ids) {
      const row = this.database
        .prepare(
          `
            SELECT id, role, message_type, content_markdown, structured_payload_json
            FROM chat_messages
            WHERE id = ?
          `,
        )
        .get(messageId) as
        | {
            id: string
            role: string
            message_type: string
            content_markdown: string | null
            structured_payload_json: string | null
          }
        | undefined

      if (!row) {
        throw new IpcProtocolError(
          "not_found",
          `Chat message not found: ${messageId}`,
        )
      }

      // Check if this message has attachments and load them from disk
      let attachments: Array<{ type: string; name: string; media_type: string; data: string }> | undefined
      if (row.structured_payload_json) {
        try {
          const payload = JSON.parse(row.structured_payload_json)
          if (payload.attachments && Array.isArray(payload.attachments)) {
            const stored = loadAttachments(row.id)
            if (stored.length > 0) {
              attachments = stored
            }
          }
        } catch { /* ignore parse errors */ }
      }

      contextMessages.push({
        id: row.id,
        role: row.role,
        messageType: row.message_type,
        content: row.content_markdown,
        ...(attachments ? { attachments } : {}),
      })
    }

    // Scan turn events for LLM-generated artifacts (specs, plans under .ultra/docs/superpowers/)
    const artifacts = this.collectArtifacts(input.chat_id, input.context_message_ids)

    const seedContext = {
      messages: contextMessages,
      ...(artifacts.length > 0 ? { artifacts } : {}),
    }
    const seedContextJson = JSON.stringify(seedContext)

    const startRequestMessage = chatService.appendMessage({
      chatId: input.chat_id,
      role: "user",
      messageType: "thread_start_request",
      contentMarkdown: `Promote to thread: ${input.title}`,
      structuredPayloadJson: JSON.stringify({
        type: "promote_to_thread",
        title: input.title,
        contextMessageIds: input.context_message_ids,
      }),
    })

    const threadId = this.createThreadWithInitialEvent(
      {
        chatId: input.chat_id,
        projectId: chat.project_id,
        title: input.title,
        summary: null,
        createdByMessageId: startRequestMessage.id,
      },
      [],
      [],
      this.buildCreatedPayload({
        chatId: input.chat_id,
        title: input.title,
        summary: null,
        specRefs: [],
        ticketRefs: [],
        creationSource: "promotion",
        promotionSummary: `Promoted from chat with ${input.context_message_ids.length} context message(s).`,
        carriedMessageIds: input.context_message_ids,
      }),
      seedContextJson,
    )

    const thread = this.getThread(threadId)

    if (this.coordinatorDispatchHandler) {
      try {
        this.coordinatorDispatchHandler.startThread({
          input: {
            chat_id: input.chat_id,
            title: input.title,
            summary: null,
            spec_refs: [],
            ticket_refs: [],
            plan_approval_message_id: "",
            spec_approval_message_id: "",
            start_request_message_id: startRequestMessage.id,
            confirm_start: true,
          },
          thread,
        })
      } catch (error) {
        this.recordDispatchFailure(
          thread.thread.projectId,
          thread.thread.id,
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    return this.getThread(threadId)
  }

  /**
   * Scan turn events for Write/Edit tool calls that created files under
   * .ultra/docs/superpowers/. Read those files from disk and return them
   * as artifact entries for the thread seed context.
   */
  private collectArtifacts(
    chatId: string,
    contextMessageIds: string[],
  ): Array<{ type: "artifact"; path: string; content: string }> {
    // Find turns associated with context messages
    const placeholders = contextMessageIds.map(() => "?").join(",")
    const turnRows = this.database
      .prepare(
        `SELECT DISTINCT t.turn_id FROM chat_turns t
         WHERE t.chat_id = ? AND t.user_message_id IN (${placeholders})`,
      )
      .all(chatId, ...contextMessageIds) as Array<{ turn_id: string }>

    if (turnRows.length === 0) return []

    // Find turn events with tool_activity containing Write/Edit
    const turnIds = turnRows.map((r) => r.turn_id)
    const turnPlaceholders = turnIds.map(() => "?").join(",")
    const eventRows = this.database
      .prepare(
        `SELECT payload_json FROM chat_turn_events
         WHERE turn_id IN (${turnPlaceholders})
         AND event_type = 'chat.turn_progress'`,
      )
      .all(...turnIds) as Array<{ payload_json: string }>

    // Extract file paths from Write/Edit tool calls
    const artifactPaths = new Set<string>()
    for (const row of eventRows) {
      try {
        const payload = JSON.parse(row.payload_json)
        if (payload.stage !== "tool_activity") continue
        const label = payload.label ?? ""
        if (label !== "Write" && label !== "Edit") continue
        const filePath = payload.metadata?.input?.file_path ?? ""
        if (typeof filePath === "string" && filePath.includes(".ultra/docs/superpowers")) {
          artifactPaths.add(filePath)
        }
      } catch { /* ignore */ }
    }

    if (artifactPaths.size === 0) return []

    // Read files from disk
    const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs")
    const artifacts: Array<{ type: "artifact"; path: string; content: string }> = []

    for (const filePath of artifactPaths) {
      if (!existsSync(filePath)) continue
      try {
        const content = readFileSync(filePath, "utf-8")
        artifacts.push({ type: "artifact", path: filePath, content })
      } catch { /* skip unreadable files */ }
    }

    return artifacts
  }

  updateThreadTitle(threadId: ThreadId, title: string): void {
    this.database
      .prepare("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, this.now(), threadId)
  }

  listByProject(projectId: ProjectId): ThreadsListResult {
    this.assertProjectExists(projectId)

    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            project_id,
            source_chat_id,
            title,
            summary,
            execution_state,
            review_state,
            publish_state,
            backend_health,
            coordinator_health,
            watch_health,
            ov_project_id,
            ov_coordinator_id,
            ov_thread_key,
            worktree_id,
            branch_name,
            base_branch,
            latest_commit_sha,
            pr_provider,
            pr_number,
            pr_url,
            last_event_sequence,
            restart_count,
            failure_reason,
            created_by_message_id,
            created_at,
            updated_at,
            last_activity_at,
            approved_at,
            completed_at
          FROM threads
          WHERE project_id = ?
          ORDER BY last_activity_at DESC, created_at DESC
        `,
      )
      .all(projectId) as ThreadRow[]

    return {
      threads: rows.map((row) => mapThreadRow(row)),
    }
  }

  listByChat(chatId: string): ThreadsListResult {
    this.assertChatExists(chatId)

    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            project_id,
            source_chat_id,
            title,
            summary,
            execution_state,
            review_state,
            publish_state,
            backend_health,
            coordinator_health,
            watch_health,
            ov_project_id,
            ov_coordinator_id,
            ov_thread_key,
            worktree_id,
            branch_name,
            base_branch,
            latest_commit_sha,
            pr_provider,
            pr_number,
            pr_url,
            last_event_sequence,
            restart_count,
            failure_reason,
            created_by_message_id,
            created_at,
            updated_at,
            last_activity_at,
            approved_at,
            completed_at
          FROM threads
          WHERE source_chat_id = ?
          ORDER BY last_activity_at DESC, created_at DESC
        `,
      )
      .all(chatId) as ThreadRow[]

    return {
      threads: rows.map((row) => mapThreadRow(row)),
    }
  }

  getThread(threadId: ThreadId): ThreadDetailResult {
    const thread = this.getThreadSnapshot(threadId)

    return {
      thread,
      specRefs: this.listSpecRefs(threadId),
      ticketRefs: this.listTicketRefs(threadId),
    }
  }

  getEvents(threadId: ThreadId, fromSequence?: number): ThreadsGetEventsResult {
    return {
      events: this.eventService.listEvents(threadId, fromSequence),
    }
  }

  getMessages(threadId: ThreadId): ThreadsGetMessagesResult {
    this.getThreadSnapshot(threadId)

    return {
      messages: (
        this.database
          .prepare(
            `
              SELECT
                id,
                thread_id,
                role,
                provider,
                model,
                message_type,
                content_json,
                artifact_refs_json,
                created_at
              FROM thread_messages
              WHERE thread_id = ?
              ORDER BY created_at ASC, rowid ASC
            `,
          )
          .all(threadId) as ThreadMessageRow[]
      ).map((row) => mapThreadMessageRow(row)),
    }
  }

  subscribeToMessages(
    threadId: ThreadId,
    listener: (message: ThreadMessageSnapshot) => void,
  ): () => void {
    this.getThreadSnapshot(threadId)
    const listeners = this.messageListenersByThreadId.get(threadId) ?? new Set()
    listeners.add(listener)
    this.messageListenersByThreadId.set(threadId, listeners)

    return () => {
      const active = this.messageListenersByThreadId.get(threadId)

      if (!active) {
        return
      }

      active.delete(listener)
      if (active.size === 0) {
        this.messageListenersByThreadId.delete(threadId)
      }
    }
  }

  sendMessage(input: ThreadsSendMessageInput): ThreadsSendMessageResult {
    const thread = this.getThreadSnapshot(input.thread_id)
    const projectId = input.project_id ?? thread.projectId

    if (thread.projectId !== projectId) {
      throw new IpcProtocolError(
        "not_found",
        `Thread ${input.thread_id} does not belong to project ${projectId}.`,
      )
    }

    const messageId = `thread_msg_${randomUUID()}`
    const snapshot = this.appendMessage({
      attachments: input.attachments,
      contentText: input.content,
      messageId,
      messageType: "text",
      projectId,
      role: "user",
      threadId: input.thread_id,
    })

    if (this.coordinatorDispatchHandler) {
      try {
        this.coordinatorDispatchHandler.sendThreadMessage({
          attachments: input.attachments,
          contentMarkdown: input.content,
          messageId,
          projectId,
          threadId: input.thread_id,
        })
      } catch (error) {
        this.recordDispatchFailure(
          projectId,
          input.thread_id,
          error instanceof Error ? error.message : String(error),
        )
        throw error
      }
    }

    return { message: snapshot }
  }

  appendMessage(input: {
    attachments?: ThreadMessageAttachment[]
    artifactRefs?: string[]
    contentText?: string | null
    createdAt?: string
    messageId?: string
    messageType: ThreadMessageType
    model?: string | null
    projectId: ProjectId
    provider?: string | null
    role: ThreadMessageRole
    threadId: ThreadId
  }): ThreadMessageSnapshot {
    const thread = this.getThreadSnapshot(input.threadId)

    if (thread.projectId !== input.projectId) {
      throw new IpcProtocolError(
        "not_found",
        `Thread ${input.threadId} does not belong to project ${input.projectId}.`,
      )
    }

    if (input.messageId) {
      const existing = readThreadMessageRow(
        this.database
          .prepare(
            `
              SELECT
                id,
                thread_id,
                role,
                provider,
                model,
                message_type,
                content_json,
                artifact_refs_json,
                created_at
              FROM thread_messages
              WHERE id = ?
            `,
          )
          .get(input.messageId),
      )

      if (existing) {
        return mapThreadMessageRow(existing)
      }
    }

    const messageId = input.messageId ?? `thread_msg_${randomUUID()}`
    const timestamp = input.createdAt ?? this.now()

    this.database
      .prepare(
        `
          INSERT INTO thread_messages (
            id,
            thread_id,
            role,
            provider,
            model,
            message_type,
            content_json,
            artifact_refs_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        messageId,
        input.threadId,
        input.role,
        input.provider ?? null,
        input.model ?? null,
        input.messageType,
        JSON.stringify({
          attachments: input.attachments ?? [],
          text: input.contentText ?? "",
        }),
        input.artifactRefs && input.artifactRefs.length > 0
          ? JSON.stringify(input.artifactRefs)
          : null,
        timestamp,
      )

    const row = readThreadMessageRow(
      this.database
        .prepare(
          `
            SELECT
              id,
              thread_id,
              role,
              provider,
              model,
              message_type,
              content_json,
              artifact_refs_json,
              created_at
            FROM thread_messages
            WHERE id = ?
          `,
        )
        .get(messageId),
    )

    if (!row) {
      throw new IpcProtocolError(
        "internal_error",
        `Thread message ${messageId} could not be loaded after insert.`,
      )
    }

    const snapshot = mapThreadMessageRow(row)
    this.notifyMessageListeners(snapshot)
    return snapshot
  }

  appendProjectedEvent(input: {
    actorId?: string | null
    actorType: string
    eventType: string
    occurredAt?: string
    payload: Record<string, unknown>
    projectId: ProjectId
    source: string
    threadId: ThreadId
  }) {
    const event = this.eventService.appendEvent(input)
    this.projectionService.applyEvent(event)
    return event
  }

  updateProjectCoordinatorHealth(projectId: ProjectId, health: string): void {
    this.assertProjectExists(projectId)
    this.database
      .prepare(
        `
          UPDATE threads
          SET coordinator_health = ?
          WHERE project_id = ?
        `,
      )
      .run(health, projectId)
  }

  listActiveCoordinatorThreadIds(projectId: ProjectId): ThreadId[] {
    this.assertProjectExists(projectId)

    return (
      this.database
        .prepare(
          `
            SELECT id
            FROM threads
            WHERE project_id = ?
              AND execution_state IN (
                'queued',
                'starting',
                'running',
                'blocked',
                'finishing'
              )
            ORDER BY last_activity_at DESC, created_at DESC
          `,
        )
        .all(projectId) as Array<{ id: ThreadId }>
    ).map((row) => row.id)
  }

  listNonTerminalThreadIds(projectId: ProjectId): ThreadId[] {
    this.assertProjectExists(projectId)

    return (
      this.database
        .prepare(
          `
            SELECT id
            FROM threads
            WHERE project_id = ?
              AND execution_state NOT IN ('completed', 'failed', 'canceled')
            ORDER BY last_activity_at DESC, created_at DESC
          `,
        )
        .all(projectId) as Array<{ id: ThreadId }>
    ).map((row) => row.id)
  }

  private notifyMessageListeners(message: ThreadMessageSnapshot): void {
    const listeners = this.messageListenersByThreadId.get(message.threadId)

    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(message)
    }
  }

  private recordDispatchFailure(
    projectId: ProjectId,
    threadId: ThreadId,
    reason: string,
  ): void {
    this.appendProjectedEvent({
      actorType: "backend",
      eventType: "thread.failed",
      payload: { reason },
      projectId,
      source: "ultra.runtime",
      threadId,
    })
    this.updateProjectCoordinatorHealth(projectId, "down")
  }

  private createThreadWithInitialEvent(
    threadInput: CreateThreadRecordInput,
    specRefs: ThreadSpecRefInput[],
    ticketRefs: ThreadTicketRefInput[],
    eventPayload: ThreadCreatedEventPayload,
    seedContextJson?: string,
  ): ThreadId {
    const timestamp = this.now()
    const threadId = `thread_${randomUUID()}`

    this.database.exec("BEGIN")

    try {
      this.database
        .prepare(
          `
            INSERT INTO threads (
              id,
              project_id,
              source_chat_id,
              title,
              summary,
              execution_state,
              review_state,
              publish_state,
              backend_health,
              coordinator_health,
              watch_health,
              ov_project_id,
              ov_coordinator_id,
              ov_thread_key,
              worktree_id,
              branch_name,
              base_branch,
              latest_commit_sha,
              pr_provider,
              pr_number,
              pr_url,
              last_event_sequence,
              restart_count,
              failure_reason,
              created_by_message_id,
              seed_context_json,
              created_at,
              updated_at,
              last_activity_at,
              approved_at,
              completed_at
            ) VALUES (?, ?, ?, ?, ?, 'queued', 'not_ready', 'not_requested', 'healthy', 'healthy', 'healthy', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, NULL, ?, ?, ?, ?, NULL, NULL, NULL)
          `,
        )
        .run(
          threadId,
          threadInput.projectId,
          threadInput.chatId,
          threadInput.title,
          threadInput.summary ?? null,
          threadInput.createdByMessageId,
          seedContextJson ?? null,
          timestamp,
          timestamp,
        )

      this.insertSpecRefs(threadId, specRefs, timestamp)
      this.insertTicketRefs(threadId, ticketRefs, timestamp)
      this.database
        .prepare(
          `
            INSERT INTO chat_thread_refs (
              chat_id,
              thread_id,
              reference_type,
              created_at
            ) VALUES (?, ?, 'spawned', ?)
          `,
        )
        .run(threadInput.chatId, threadId, timestamp)

      const event = this.eventService.appendEvent({
        projectId: threadInput.projectId,
        threadId,
        eventType: "thread.created",
        actorType: "chat",
        actorId: threadInput.chatId,
        source: "ultra.chat",
        payload: eventPayload,
        occurredAt: timestamp,
      })

      this.projectionService.applyEvent(event)

      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }

    return threadId
  }

  private buildCreatedPayload(input: {
    chatId: string
    title: string
    summary: string | null
    specRefs: ThreadSpecRefInput[]
    ticketRefs: ThreadTicketRefInput[]
    creationSource: "start_thread" | "promotion"
    promotionSummary?: string | null
    carriedMessageIds?: string[]
    carriedCheckpointIds?: string[]
    carriedArtifactRefs?: string[]
    carriedSeedRefs?: string[]
  }): ThreadCreatedEventPayload {
    return {
      sourceChatId: input.chatId,
      title: input.title,
      summary: input.summary,
      initialSpecIds: input.specRefs.map((ref) => ref.spec_path),
      initialTicketRefs: input.ticketRefs.map((ref) => ({
        provider: ref.provider,
        externalId: ref.external_id,
        displayLabel: ref.display_label,
        url: ref.url ?? null,
        metadata: ref.metadata ?? null,
      })),
      initialExecutionState: "queued",
      initialReviewState: "not_ready",
      initialPublishState: "not_requested",
      creationSource: input.creationSource,
      promotionSummary: input.promotionSummary ?? null,
      carriedMessageIds: input.carriedMessageIds ?? [],
      carriedCheckpointIds: input.carriedCheckpointIds ?? [],
      carriedArtifactRefs: input.carriedArtifactRefs ?? [],
      carriedSeedRefs: input.carriedSeedRefs ?? [],
    }
  }

  private insertSpecRefs(
    threadId: ThreadId,
    specRefs: ThreadSpecRefInput[],
    createdAt: string,
  ): void {
    const statement = this.database.prepare(
      `
        INSERT INTO thread_specs (
          thread_id,
          spec_path,
          spec_slug,
          created_at
        ) VALUES (?, ?, ?, ?)
      `,
    )

    for (const specRef of specRefs) {
      statement.run(threadId, specRef.spec_path, specRef.spec_slug, createdAt)
    }
  }

  private insertTicketRefs(
    threadId: ThreadId,
    ticketRefs: ThreadTicketRefInput[],
    createdAt: string,
  ): void {
    const statement = this.database.prepare(
      `
        INSERT INTO thread_ticket_refs (
          thread_id,
          provider,
          external_id,
          display_label,
          url,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )

    for (const ticketRef of ticketRefs) {
      statement.run(
        threadId,
        ticketRef.provider,
        ticketRef.external_id,
        ticketRef.display_label,
        ticketRef.url ?? null,
        ticketRef.metadata ? JSON.stringify(ticketRef.metadata) : null,
        createdAt,
      )
    }
  }

  private listSpecRefs(threadId: ThreadId): ThreadSpecRefSnapshot[] {
    return (
      this.database
        .prepare(
          `
            SELECT thread_id, spec_path, spec_slug, created_at
            FROM thread_specs
            WHERE thread_id = ?
            ORDER BY created_at ASC, spec_path ASC
          `,
        )
        .all(threadId) as ThreadSpecRefRow[]
    ).map((row) => mapThreadSpecRefRow(row))
  }

  private listTicketRefs(threadId: ThreadId): ThreadTicketRefSnapshot[] {
    return (
      this.database
        .prepare(
          `
            SELECT
              thread_id,
              provider,
              external_id,
              display_label,
              url,
              metadata_json,
              created_at
            FROM thread_ticket_refs
            WHERE thread_id = ?
            ORDER BY created_at ASC, provider ASC, external_id ASC
          `,
        )
        .all(threadId) as ThreadTicketRefRow[]
    ).map((row) => mapThreadTicketRefRow(row))
  }

  private getThreadSnapshot(threadId: ThreadId): ThreadSnapshot {
    const row = readThreadRow(
      this.database
        .prepare(
          `
            SELECT
              id,
              project_id,
              source_chat_id,
              title,
              summary,
              execution_state,
              review_state,
              publish_state,
              backend_health,
              coordinator_health,
              watch_health,
              ov_project_id,
              ov_coordinator_id,
              ov_thread_key,
              worktree_id,
              branch_name,
              base_branch,
              latest_commit_sha,
              pr_provider,
              pr_number,
              pr_url,
              last_event_sequence,
              restart_count,
              failure_reason,
              created_by_message_id,
              created_at,
              updated_at,
              last_activity_at,
              approved_at,
              completed_at
            FROM threads
            WHERE id = ?
          `,
        )
        .get(threadId),
    )

    if (!row) {
      throw new IpcProtocolError("not_found", `Thread not found: ${threadId}`)
    }

    return mapThreadRow(row)
  }

  private getThreadByCreatedByMessageId(messageId: string): ThreadRow | null {
    return readThreadRow(
      this.database
        .prepare(
          `
            SELECT
              id,
              project_id,
              source_chat_id,
              title,
              summary,
              execution_state,
              review_state,
              publish_state,
              backend_health,
              coordinator_health,
              watch_health,
              ov_project_id,
              ov_coordinator_id,
              ov_thread_key,
              worktree_id,
              branch_name,
              base_branch,
              latest_commit_sha,
              pr_provider,
              pr_number,
              pr_url,
              last_event_sequence,
              restart_count,
              failure_reason,
              created_by_message_id,
              created_at,
              updated_at,
              last_activity_at,
              approved_at,
              completed_at
            FROM threads
            WHERE created_by_message_id = ?
          `,
        )
        .get(messageId),
    )
  }

  private assertProjectExists(projectId: ProjectId): void {
    const row = this.database
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(projectId)

    if (!row) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }
  }

  private assertChatExists(chatId: string): ChatRow {
    const row = readChatRow(
      this.database
        .prepare("SELECT id, project_id FROM chats WHERE id = ?")
        .get(chatId),
    )

    if (!row) {
      throw new IpcProtocolError("not_found", `Chat not found: ${chatId}`)
    }

    return row
  }

  private assertChatMessageType(
    chatId: string,
    messageId: string,
    expectedType: string,
  ): {
    sequence_number: number
  } {
    const row = this.database
      .prepare(
        `
          SELECT
            chat_id,
            message_type,
            rowid AS sequence_number
          FROM chat_messages
          WHERE id = ?
        `,
      )
      .get(messageId) as
      | {
          chat_id: string
          message_type: string
          sequence_number: number
        }
      | undefined

    if (!row) {
      throw new IpcProtocolError(
        "not_found",
        `Chat message not found: ${messageId}`,
      )
    }

    if (row.chat_id !== chatId) {
      throw new IpcProtocolError(
        "invalid_request",
        `Chat message ${messageId} does not belong to chat ${chatId}.`,
      )
    }

    if (row.message_type !== expectedType) {
      throw new IpcProtocolError(
        "invalid_request",
        `Chat message ${messageId} must have type ${expectedType}.`,
      )
    }

    return {
      sequence_number: row.sequence_number,
    }
  }

  private assertMessageSequence(
    ...messages: Array<
      [
        {
          sequence_number: number
        },
        string,
      ]
    >
  ): void {
    for (let index = 1; index < messages.length; index += 1) {
      const previous = messages[index - 1]
      const current = messages[index]

      if (!previous || !current) {
        continue
      }

      if (previous[0].sequence_number >= current[0].sequence_number) {
        throw new IpcProtocolError(
          "invalid_request",
          `${current[1]} must occur after ${previous[1]}.`,
        )
      }
    }
  }

  private assertMessagesBelongToChat(
    chatId: string,
    messageIds: string[],
  ): void {
    for (const messageId of messageIds) {
      const row = this.database
        .prepare("SELECT chat_id FROM chat_messages WHERE id = ?")
        .get(messageId) as { chat_id: string } | undefined

      if (!row) {
        throw new IpcProtocolError(
          "not_found",
          `Chat message not found: ${messageId}`,
        )
      }

      if (row.chat_id !== chatId) {
        throw new IpcProtocolError(
          "invalid_request",
          `Chat message ${messageId} does not belong to chat ${chatId}.`,
        )
      }
    }
  }

  private assertCheckpointsBelongToChat(
    chatId: string,
    checkpointIds: string[],
  ): void {
    for (const checkpointId of checkpointIds) {
      const row = this.database
        .prepare("SELECT chat_id FROM chat_action_checkpoints WHERE id = ?")
        .get(checkpointId) as { chat_id: string } | undefined

      if (!row) {
        throw new IpcProtocolError(
          "not_found",
          `Chat checkpoint not found: ${checkpointId}`,
        )
      }

      if (row.chat_id !== chatId) {
        throw new IpcProtocolError(
          "invalid_request",
          `Chat checkpoint ${checkpointId} does not belong to chat ${chatId}.`,
        )
      }
    }
  }
}
