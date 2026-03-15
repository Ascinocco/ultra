import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type {
  ChatsPromoteWorkToThreadInput,
  ChatsStartThreadInput,
  ThreadDetailResult,
  ThreadSnapshot,
  ThreadSpecRefSnapshot,
  ThreadSummary,
  ThreadsGetEventsResult,
  ThreadsListResult,
  ThreadTicketRefSnapshot,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import {
  type AppendThreadEventInput,
  ThreadEventService,
} from "./thread-event-service.js"
import { ThreadProjectionService } from "./thread-projection-service.js"

type ChatRow = {
  id: string
  project_id: string
  title: string
}

type ChatMessageRow = {
  id: string
  chat_id: string
  message_type: string
}

type ChatCheckpointRow = {
  id: string
  chat_id: string
  artifact_refs_json: string | null
}

type ThreadRow = {
  id: string
  project_id: string
  source_chat_id: string
  title: string
  summary: string | null
  execution_state: string
  review_state: string
  publish_state: string
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

function mapThreadRow(row: ThreadRow): ThreadSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceChatId: row.source_chat_id,
    title: row.title,
    summary: row.summary,
    executionState: row.execution_state as ThreadSnapshot["executionState"],
    reviewState: row.review_state as ThreadSnapshot["reviewState"],
    publishState: row.publish_state as ThreadSnapshot["publishState"],
    backendHealth: row.backend_health as ThreadSnapshot["backendHealth"],
    coordinatorHealth:
      row.coordinator_health as ThreadSnapshot["coordinatorHealth"],
    watchHealth: row.watch_health as ThreadSnapshot["watchHealth"],
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
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
  }
}

function readArtifactRefs(value: string | null): string[] {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

export class ThreadService {
  readonly eventService: ThreadEventService
  readonly projectionService: ThreadProjectionService

  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
    eventService?: ThreadEventService,
    projectionService?: ThreadProjectionService,
  ) {
    this.eventService = eventService ?? new ThreadEventService(database, now)
    this.projectionService =
      projectionService ?? new ThreadProjectionService(database)
  }

  startThread(input: ChatsStartThreadInput): ThreadDetailResult {
    const chat = this.getChatRow(input.chat_id)
    this.assertMessageInChat(
      input.start_request_message_id,
      chat.id,
      "thread_start_request",
      "start request",
    )

    const existing = this.findByCreatedByMessageId(
      input.start_request_message_id,
    )

    if (existing) {
      return this.getThread(existing.id)
    }

    this.assertMessageInChat(
      input.plan_approval_message_id,
      chat.id,
      "plan_approval",
      "plan approval",
    )
    this.assertMessageInChat(
      input.spec_approval_message_id,
      chat.id,
      "spec_approval",
      "spec approval",
    )

    const timestamp = this.now()
    const threadId = `thread_${randomUUID()}`
    const title = this.normalizeTitle(input.title, chat.title)
    const summary = this.normalizeNullableText(input.summary)

    this.database.exec("BEGIN")

    try {
      this.insertThreadRow({
        threadId,
        projectId: chat.project_id,
        chatId: chat.id,
        title,
        summary,
        createdByMessageId: input.start_request_message_id,
        timestamp,
      })
      this.insertSpecRefs(threadId, input.spec_refs, timestamp)
      this.insertTicketRefs(threadId, input.ticket_refs, timestamp)
      this.insertChatThreadRef(chat.id, threadId, timestamp)

      const event = this.appendCreatedEvent({
        projectId: chat.project_id,
        threadId,
        chatId: chat.id,
        title,
        summary,
        startRequestMessageId: input.start_request_message_id,
        planApprovalMessageId: input.plan_approval_message_id,
        specApprovalMessageId: input.spec_approval_message_id,
        specRefs: input.spec_refs,
        ticketRefs: input.ticket_refs,
        creationSource: "start_thread",
        promotionSummary: null,
        carriedMessageIds: [],
        carriedCheckpointIds: [],
        carriedArtifactRefs: [],
        carriedSeedRefs: [],
        timestamp,
      })

      this.projectionService.applyEvent(event)
      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }

    return this.getThread(threadId)
  }

  promoteWorkToThread(
    input: ChatsPromoteWorkToThreadInput,
  ): ThreadDetailResult {
    const chat = this.getChatRow(input.chat_id)
    const promotionSummary = input.promotion_summary.trim()

    if (promotionSummary.length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Promotion summary is required.",
      )
    }

    this.assertMessageInChat(
      input.start_request_message_id,
      chat.id,
      "thread_start_request",
      "start request",
    )

    const existing = this.findByCreatedByMessageId(
      input.start_request_message_id,
    )

    if (existing) {
      return this.getThread(existing.id)
    }

    if (input.plan_approval_message_id) {
      this.assertMessageInChat(
        input.plan_approval_message_id,
        chat.id,
        "plan_approval",
        "plan approval",
      )
    }

    if (input.spec_approval_message_id) {
      this.assertMessageInChat(
        input.spec_approval_message_id,
        chat.id,
        "spec_approval",
        "spec approval",
      )
    }

    const checkpointRows = input.selected_checkpoint_ids.map((checkpointId) =>
      this.assertCheckpointInChat(checkpointId, chat.id),
    )

    input.selected_message_ids.forEach((messageId) => {
      this.assertMessageBelongsToChat(messageId, chat.id)
    })

    const carriedArtifactRefs = dedupe(
      checkpointRows.flatMap((checkpoint) =>
        readArtifactRefs(checkpoint.artifact_refs_json),
      ),
    )
    const timestamp = this.now()
    const threadId = `thread_${randomUUID()}`
    const title = this.normalizeTitle(input.title, chat.title)
    const summary =
      this.normalizeNullableText(input.summary) ?? promotionSummary

    this.database.exec("BEGIN")

    try {
      this.insertThreadRow({
        threadId,
        projectId: chat.project_id,
        chatId: chat.id,
        title,
        summary,
        createdByMessageId: input.start_request_message_id,
        timestamp,
      })
      this.insertSpecRefs(threadId, input.spec_refs, timestamp)
      this.insertTicketRefs(threadId, input.ticket_refs, timestamp)
      this.insertChatThreadRef(chat.id, threadId, timestamp)

      const event = this.appendCreatedEvent({
        projectId: chat.project_id,
        threadId,
        chatId: chat.id,
        title,
        summary,
        startRequestMessageId: input.start_request_message_id,
        planApprovalMessageId: input.plan_approval_message_id ?? null,
        specApprovalMessageId: input.spec_approval_message_id ?? null,
        specRefs: input.spec_refs,
        ticketRefs: input.ticket_refs,
        creationSource: "promotion",
        promotionSummary,
        carriedMessageIds: input.selected_message_ids,
        carriedCheckpointIds: input.selected_checkpoint_ids,
        carriedArtifactRefs,
        carriedSeedRefs: input.carried_seed_refs,
        timestamp,
      })

      this.projectionService.applyEvent(event)
      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }

    return this.getThread(threadId)
  }

  listByProject(projectId: string): ThreadsListResult {
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
      threads: rows.map((row) => mapThreadRow(row) satisfies ThreadSummary),
    }
  }

  listByChat(chatId: string): ThreadsListResult {
    this.getChatRow(chatId)

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
      threads: rows.map((row) => mapThreadRow(row) satisfies ThreadSummary),
    }
  }

  getThread(threadId: string): ThreadDetailResult {
    const thread = this.getThreadRow(threadId)
    const specRefs = this.database
      .prepare(
        `
          SELECT thread_id, spec_path, spec_slug, created_at
          FROM thread_specs
          WHERE thread_id = ?
          ORDER BY created_at ASC, spec_path ASC
        `,
      )
      .all(threadId)
      .map((row) => mapThreadSpecRefRow(row as ThreadSpecRefRow))
    const ticketRefs = this.database
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
      .all(threadId)
      .map((row) => mapThreadTicketRefRow(row as ThreadTicketRefRow))

    return {
      thread: mapThreadRow(thread),
      specRefs,
      ticketRefs,
    }
  }

  getEvents(threadId: string, fromSequence = 0): ThreadsGetEventsResult {
    this.getThreadRow(threadId)

    return {
      events: this.eventService.listEvents(threadId, fromSequence),
    }
  }

  private appendCreatedEvent(input: {
    projectId: string
    threadId: string
    chatId: string
    title: string
    summary: string | null
    startRequestMessageId: string
    planApprovalMessageId: string | null
    specApprovalMessageId: string | null
    specRefs: ChatsStartThreadInput["spec_refs"]
    ticketRefs: ChatsStartThreadInput["ticket_refs"]
    creationSource: "start_thread" | "promotion"
    promotionSummary: string | null
    carriedMessageIds: string[]
    carriedCheckpointIds: string[]
    carriedArtifactRefs: string[]
    carriedSeedRefs: string[]
    timestamp: string
  }) {
    const eventInput: AppendThreadEventInput = {
      projectId: input.projectId,
      threadId: input.threadId,
      eventType: "thread.created",
      actorType: "chat",
      actorId: input.chatId,
      source: "ultra.chat",
      occurredAt: input.timestamp,
      payload: {
        creationSource: input.creationSource,
        sourceChatId: input.chatId,
        title: input.title,
        summary: input.summary,
        startRequestMessageId: input.startRequestMessageId,
        planApprovalMessageId: input.planApprovalMessageId,
        specApprovalMessageId: input.specApprovalMessageId,
        initialSpecRefs: input.specRefs,
        initialTicketRefs: input.ticketRefs,
        initialExecutionState: "queued",
        initialReviewState: "not_ready",
        initialPublishState: "not_requested",
        promotionSummary: input.promotionSummary,
        carriedMessageIds: input.carriedMessageIds,
        carriedCheckpointIds: input.carriedCheckpointIds,
        carriedArtifactRefs: input.carriedArtifactRefs,
        carriedSeedRefs: input.carriedSeedRefs,
      },
    }

    return this.eventService.append(eventInput)
  }

  private insertThreadRow(input: {
    threadId: string
    projectId: string
    chatId: string
    title: string
    summary: string | null
    createdByMessageId: string
    timestamp: string
  }): void {
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
            created_at,
            updated_at,
            last_activity_at,
            approved_at,
            completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 0, NULL, ?, ?, ?, ?, NULL, NULL)
        `,
      )
      .run(
        input.threadId,
        input.projectId,
        input.chatId,
        input.title,
        input.summary,
        "queued",
        "not_ready",
        "not_requested",
        "healthy",
        "healthy",
        "healthy",
        input.createdByMessageId,
        input.timestamp,
        input.timestamp,
        input.timestamp,
      )
  }

  private insertSpecRefs(
    threadId: string,
    specRefs: ChatsStartThreadInput["spec_refs"],
    timestamp: string,
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

    specRefs.forEach((specRef) => {
      statement.run(threadId, specRef.spec_path, specRef.spec_slug, timestamp)
    })
  }

  private insertTicketRefs(
    threadId: string,
    ticketRefs: ChatsStartThreadInput["ticket_refs"],
    timestamp: string,
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

    ticketRefs.forEach((ticketRef) => {
      statement.run(
        threadId,
        ticketRef.provider,
        ticketRef.external_id,
        ticketRef.display_label,
        ticketRef.url ?? null,
        ticketRef.metadata_json ?? null,
        timestamp,
      )
    })
  }

  private insertChatThreadRef(
    chatId: string,
    threadId: string,
    timestamp: string,
  ): void {
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
      .run(chatId, threadId, timestamp)
  }

  private findByCreatedByMessageId(messageId: string): ThreadRow | null {
    const row = this.database
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
      .get(messageId)

    return row ? (row as ThreadRow) : null
  }

  private getThreadRow(threadId: string): ThreadRow {
    const row = this.database
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
      .get(threadId)

    if (!row) {
      throw new IpcProtocolError("not_found", `Thread not found: ${threadId}`)
    }

    return row as ThreadRow
  }

  private getChatRow(chatId: string): ChatRow {
    const row = this.database
      .prepare(
        `
          SELECT id, project_id, title
          FROM chats
          WHERE id = ?
        `,
      )
      .get(chatId)

    if (!row) {
      throw new IpcProtocolError("not_found", `Chat not found: ${chatId}`)
    }

    return row as ChatRow
  }

  private assertProjectExists(projectId: string): void {
    const row = this.database
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(projectId)

    if (!row) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }
  }

  private assertMessageInChat(
    messageId: string,
    chatId: string,
    expectedType: string,
    label: string,
  ): ChatMessageRow {
    const row = this.database
      .prepare(
        `
          SELECT id, chat_id, message_type
          FROM chat_messages
          WHERE id = ?
        `,
      )
      .get(messageId)

    if (!row) {
      throw new IpcProtocolError(
        "invalid_request",
        `Missing ${label} message: ${messageId}`,
      )
    }

    const message = row as ChatMessageRow

    if (message.chat_id !== chatId) {
      throw new IpcProtocolError(
        "invalid_request",
        `${label} message ${messageId} does not belong to chat ${chatId}.`,
      )
    }

    if (message.message_type !== expectedType) {
      throw new IpcProtocolError(
        "invalid_request",
        `${label} message ${messageId} must have message_type ${expectedType}.`,
      )
    }

    return message
  }

  private assertMessageBelongsToChat(messageId: string, chatId: string): void {
    const row = this.database
      .prepare(
        `
          SELECT id, chat_id, message_type
          FROM chat_messages
          WHERE id = ?
        `,
      )
      .get(messageId)

    if (!row) {
      throw new IpcProtocolError(
        "invalid_request",
        `Selected message not found: ${messageId}`,
      )
    }

    const message = row as ChatMessageRow

    if (message.chat_id !== chatId) {
      throw new IpcProtocolError(
        "invalid_request",
        `Selected message ${messageId} does not belong to chat ${chatId}.`,
      )
    }
  }

  private assertCheckpointInChat(
    checkpointId: string,
    chatId: string,
  ): ChatCheckpointRow {
    const row = this.database
      .prepare(
        `
          SELECT id, chat_id, artifact_refs_json
          FROM chat_action_checkpoints
          WHERE id = ?
        `,
      )
      .get(checkpointId)

    if (!row) {
      throw new IpcProtocolError(
        "invalid_request",
        `Selected checkpoint not found: ${checkpointId}`,
      )
    }

    const checkpoint = row as ChatCheckpointRow

    if (checkpoint.chat_id !== chatId) {
      throw new IpcProtocolError(
        "invalid_request",
        `Selected checkpoint ${checkpointId} does not belong to chat ${chatId}.`,
      )
    }

    return checkpoint
  }

  private normalizeTitle(
    inputTitle: string | undefined,
    fallback: string,
  ): string {
    if (typeof inputTitle !== "string") {
      return fallback
    }

    const normalized = inputTitle.trim()

    if (normalized.length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Thread title must not be empty.",
      )
    }

    return normalized
  }

  private normalizeNullableText(
    value: string | null | undefined,
  ): string | null {
    if (typeof value !== "string") {
      return value ?? null
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
  }
}
