import { randomUUID } from "node:crypto"
import type { DatabaseSync, SQLInputValue } from "node:sqlite"
import type {
  ChatId,
  ChatSessionSnapshot,
  ChatSnapshot,
  ChatSummary,
  ChatsListResult,
  ProjectId,
  ChatSnapshot as SharedChatSnapshot,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"

type ChatRow = {
  id: string
  project_id: string
  title: string
  status: "active" | "archived"
  provider: "codex" | "claude"
  model: string
  thinking_level: string
  permission_level: "supervised" | "full_access"
  is_pinned: number
  pinned_at: string | null
  archived_at: string | null
  last_compacted_at: string | null
  current_session_id: string | null
  workspace_description: string | null
  created_at: string
  updated_at: string
}

type ChatSessionRow = {
  id: string
  chat_id: string
  sequence_number: number
  started_at: string
  ended_at: string | null
  compaction_source_session_id: string | null
  compaction_summary: string | null
  continuation_prompt: string | null
}

type ChatMessageRow = {
  id: string
  chat_id: string
  session_id: string
  role: string
  message_type: string
  content_markdown: string | null
  structured_payload_json: string | null
  provider_message_id: string | null
  created_at: string
}

type ChatMessageSequenceRow = {
  id: string
  sequence_number: number
}

type ChatThreadRefRow = {
  chat_id: string
  thread_id: string
  reference_type: string
  created_at: string
}

type ChatChatRefRow = {
  source_chat_id: string
  target_chat_id: string
  reference_type: string
  created_at: string
}

export type ChatMessageSnapshot = {
  id: string
  chatId: string
  sessionId: string
  role: string
  messageType: string
  contentMarkdown: string | null
  structuredPayloadJson: string | null
  providerMessageId: string | null
  createdAt: string
}

export type ChatRuntimeConfig = Pick<
  SharedChatSnapshot,
  "provider" | "model" | "thinkingLevel" | "permissionLevel"
>

export type ChatRuntimeContext = {
  chat: ChatSnapshot
  projectId: ProjectId
  rootPath: string
  chatSessionId: string
  continuationPrompt: string | null
}

export type CreateChatMessageInput = {
  chatId: ChatId
  sessionId?: string
  role: string
  messageType: string
  contentMarkdown?: string | null
  structuredPayloadJson?: string | null
  providerMessageId?: string | null
}

export type CreateChatActionCheckpointInput = {
  chatId: ChatId
  sessionId?: string
  activeTargetPath?: string | null
  branchName?: string | null
  worktreePath?: string | null
  actionType: string
  affectedPaths: string[]
  commandMetadataJson?: string | null
  resultSummary?: string | null
  artifactRefsJson?: string | null
}

export type ChatThreadRefSnapshot = {
  chatId: string
  threadId: string
  referenceType: string
  createdAt: string
}

export type ChatChatRefSnapshot = {
  sourceChatId: string
  targetChatId: string
  referenceType: string
  createdAt: string
}

const DEFAULT_CHAT_TITLE = "Untitled Chat"
const DEFAULT_CHAT_PROVIDER = "claude"
const DEFAULT_CHAT_MODEL = "claude-opus-4-6"
const DEFAULT_CHAT_THINKING_LEVEL = "medium"
const DEFAULT_CHAT_PERMISSION_LEVEL = "full_access"

const CHAT_SELECT_COLUMNS = `
  SELECT
    id,
    project_id,
    title,
    status,
    provider,
    model,
    thinking_level,
    permission_level,
    is_pinned,
    pinned_at,
    archived_at,
    last_compacted_at,
    current_session_id,
    workspace_description,
    created_at,
    updated_at
  FROM chats
`

function readChatRow(statementResult: unknown): ChatRow | null {
  if (!statementResult || typeof statementResult !== "object") {
    return null
  }

  return statementResult as ChatRow
}

function readStringRow(statementResult: unknown, key: string): string | null {
  if (!statementResult || typeof statementResult !== "object") {
    return null
  }

  const candidate = statementResult as Record<string, unknown>
  return typeof candidate[key] === "string" ? candidate[key] : null
}

function mapChatRow(row: ChatRow): ChatSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    provider: row.provider,
    model: row.model,
    thinkingLevel: row.thinking_level,
    permissionLevel: row.permission_level,
    isPinned: row.is_pinned === 1,
    pinnedAt: row.pinned_at,
    archivedAt: row.archived_at,
    lastCompactedAt: row.last_compacted_at,
    currentSessionId: row.current_session_id,
    workspaceDescription: row.workspace_description,
    turnStatus: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapChatSessionRow(row: ChatSessionRow): ChatSessionSnapshot {
  return {
    id: row.id,
    chatId: row.chat_id,
    sequenceNumber: row.sequence_number,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    compactionSourceSessionId: row.compaction_source_session_id,
    compactionSummary: row.compaction_summary,
    continuationPrompt: row.continuation_prompt,
  }
}

function mapChatMessageRow(row: ChatMessageRow): ChatMessageSnapshot {
  return {
    id: row.id,
    chatId: row.chat_id,
    sessionId: row.session_id,
    role: row.role,
    messageType: row.message_type,
    contentMarkdown: row.content_markdown,
    structuredPayloadJson: row.structured_payload_json,
    providerMessageId: row.provider_message_id,
    createdAt: row.created_at,
  }
}

function mapChatThreadRefRow(row: ChatThreadRefRow): ChatThreadRefSnapshot {
  return {
    chatId: row.chat_id,
    threadId: row.thread_id,
    referenceType: row.reference_type,
    createdAt: row.created_at,
  }
}

function mapChatChatRefRow(row: ChatChatRefRow): ChatChatRefSnapshot {
  return {
    sourceChatId: row.source_chat_id,
    targetChatId: row.target_chat_id,
    referenceType: row.reference_type,
    createdAt: row.created_at,
  }
}

export class ChatService {
  private readonly messageListenersByChatId = new Map<
    ChatId,
    Set<(message: ChatMessageSnapshot) => void>
  >()

  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  create(projectId: ProjectId): ChatSnapshot {
    this.assertProjectExists(projectId)

    const timestamp = this.now()
    const chatId = `chat_${randomUUID()}`
    const sessionId = `chat_sess_${randomUUID()}`

    this.database.exec("BEGIN")

    try {
      this.database
        .prepare(
          `
            INSERT INTO chats (
              id,
              project_id,
              title,
              status,
              provider,
              model,
              thinking_level,
              permission_level,
              is_pinned,
              pinned_at,
              archived_at,
              last_compacted_at,
              current_session_id,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          chatId,
          projectId,
          DEFAULT_CHAT_TITLE,
          DEFAULT_CHAT_PROVIDER,
          DEFAULT_CHAT_MODEL,
          DEFAULT_CHAT_THINKING_LEVEL,
          DEFAULT_CHAT_PERMISSION_LEVEL,
          timestamp,
          timestamp,
        )

      this.database
        .prepare(
          `
            INSERT INTO chat_sessions (
              id,
              chat_id,
              sequence_number,
              started_at,
              ended_at,
              compaction_source_session_id,
              compaction_summary,
              continuation_prompt
            ) VALUES (?, ?, 1, ?, NULL, NULL, NULL, NULL)
          `,
        )
        .run(sessionId, chatId, timestamp)

      this.database
        .prepare("UPDATE chats SET current_session_id = ? WHERE id = ?")
        .run(sessionId, chatId)

      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }

    return this.get(chatId)
  }

  deriveTurnStatus(chatId: ChatId): "running" | "waiting_for_input" | "error" | null {
    const activeTurn = this.database
      .prepare(
        "SELECT turn_id FROM chat_turns WHERE chat_id = ? AND status IN ('queued', 'running') LIMIT 1",
      )
      .get(chatId)

    if (activeTurn) return "running"

    const latestTurn = this.database
      .prepare(
        "SELECT status FROM chat_turns WHERE chat_id = ? ORDER BY started_at DESC LIMIT 1",
      )
      .get(chatId) as { status: string } | undefined

    if (!latestTurn) return null
    if (latestTurn.status === "failed") return "error"
    return "waiting_for_input"
  }

  list(projectId: ProjectId, includeArchived: boolean = false): ChatsListResult {
    this.assertProjectExists(projectId)

    const rows = this.database
      .prepare(
        `
          ${CHAT_SELECT_COLUMNS}
          WHERE project_id = ?${includeArchived ? "" : " AND status = 'active'"}
          ORDER BY is_pinned DESC, updated_at DESC
        `,
      )
      .all(projectId) as ChatRow[]

    return {
      chats: rows.map((row) => {
        const chat = mapChatRow(row)
        chat.turnStatus = this.deriveTurnStatus(chat.id)
        return chat satisfies ChatSummary
      }),
    }
  }

  get(chatId: ChatId): ChatSnapshot {
    const chat = readChatRow(
      this.database.prepare(`${CHAT_SELECT_COLUMNS} WHERE id = ?`).get(chatId),
    )

    if (!chat) {
      throw new IpcProtocolError("not_found", `Chat not found: ${chatId}`)
    }

    const snapshot = mapChatRow(chat)
    snapshot.turnStatus = this.deriveTurnStatus(chatId)
    return snapshot
  }

  rename(chatId: ChatId, title: string): ChatSnapshot {
    const normalizedTitle = title.trim()

    if (normalizedTitle.length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Chat title must not be empty.",
      )
    }

    this.updateChat(chatId, {
      sql: "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
      params: [normalizedTitle, this.now(), chatId],
    })

    return this.get(chatId)
  }

  pin(chatId: ChatId): ChatSnapshot {
    const timestamp = this.now()
    this.updateChat(chatId, {
      sql: "UPDATE chats SET is_pinned = 1, pinned_at = ?, updated_at = ? WHERE id = ?",
      params: [timestamp, timestamp, chatId],
    })

    return this.get(chatId)
  }

  unpin(chatId: ChatId): ChatSnapshot {
    const timestamp = this.now()
    this.updateChat(chatId, {
      sql: "UPDATE chats SET is_pinned = 0, pinned_at = NULL, updated_at = ? WHERE id = ?",
      params: [timestamp, chatId],
    })

    return this.get(chatId)
  }

  archive(chatId: ChatId): ChatSnapshot {
    const timestamp = this.now()
    this.updateChat(chatId, {
      sql: "UPDATE chats SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?",
      params: [timestamp, timestamp, chatId],
    })

    return this.get(chatId)
  }

  restore(chatId: ChatId): ChatSnapshot {
    const timestamp = this.now()
    this.updateChat(chatId, {
      sql: "UPDATE chats SET status = 'active', archived_at = NULL, updated_at = ? WHERE id = ?",
      params: [timestamp, chatId],
    })

    return this.get(chatId)
  }

  updateRuntimeConfig(chatId: ChatId, config: ChatRuntimeConfig): ChatSnapshot {
    if (config.model.trim().length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Chat model must not be empty.",
      )
    }

    if (config.thinkingLevel.trim().length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Chat thinking level must not be empty.",
      )
    }

    this.updateChat(chatId, {
      sql: `
        UPDATE chats
        SET
          provider = ?,
          model = ?,
          thinking_level = ?,
          permission_level = ?,
          updated_at = ?
        WHERE id = ?
      `,
      params: [
        config.provider,
        config.model.trim(),
        config.thinkingLevel.trim(),
        config.permissionLevel,
        this.now(),
        chatId,
      ],
    })

    return this.get(chatId)
  }

  updateWorkspaceDescription(chatId: ChatId, description: string): void {
    const timestamp = this.now()
    this.database
      .prepare(
        "UPDATE chats SET workspace_description = ?, updated_at = ? WHERE id = ?",
      )
      .run(description, timestamp, chatId)
  }

  approvePlan(chatId: ChatId): ChatMessageSnapshot {
    this.get(chatId)

    return this.appendMessage({
      chatId,
      role: "user",
      messageType: "plan_approval",
      contentMarkdown: "Plan approved.",
      structuredPayloadJson: JSON.stringify({
        type: "plan_approval",
        approved: true,
      }),
    })
  }

  approveSpecs(chatId: ChatId): ChatMessageSnapshot {
    this.get(chatId)

    const latestPlanApproval = this.getLatestMessageByType(chatId, "plan_approval")
    if (!latestPlanApproval) {
      throw new IpcProtocolError(
        "invalid_request",
        "Plan approval is required before specs can be approved.",
      )
    }

    const latestSpecApproval = this.getLatestMessageByType(chatId, "spec_approval")
    if (
      latestSpecApproval &&
      latestSpecApproval.sequence_number >= latestPlanApproval.sequence_number
    ) {
      throw new IpcProtocolError(
        "invalid_request",
        "Specs are already approved for the latest approved plan.",
      )
    }

    return this.appendMessage({
      chatId,
      role: "user",
      messageType: "spec_approval",
      contentMarkdown: "Specs approved.",
      structuredPayloadJson: JSON.stringify({
        type: "spec_approval",
        approved: true,
        planApprovalMessageId: latestPlanApproval.id,
      }),
    })
  }

  createPlanMarker(chatId: ChatId, markerType: "open" | "close"): ChatMessageSnapshot {
    this.get(chatId)

    return this.appendMessage({
      chatId,
      role: "user",
      messageType: markerType === "open" ? "plan_marker_open" : "plan_marker_close",
      contentMarkdown: markerType === "open" ? "Planning started" : "Planning complete",
    })
  }

  confirmStartWork(
    chatId: ChatId,
    input?: {
      threadTitle?: string
      threadSummary?: string | null
    },
  ): ChatMessageSnapshot {
    this.get(chatId)

    const latestPlanApproval = this.getLatestMessageByType(chatId, "plan_approval")
    const latestSpecApproval = this.getLatestMessageByType(chatId, "spec_approval")

    if (!latestPlanApproval || !latestSpecApproval) {
      throw new IpcProtocolError(
        "invalid_request",
        "Plan and spec approvals are required before starting work.",
      )
    }

    if (latestPlanApproval.sequence_number >= latestSpecApproval.sequence_number) {
      throw new IpcProtocolError(
        "invalid_request",
        "Plan must be approved before specs, and specs must be the latest approval step before starting work.",
      )
    }

    const latestStartRequest = this.getLatestMessageByType(
      chatId,
      "thread_start_request",
    )
    if (
      latestStartRequest &&
      latestStartRequest.sequence_number >= latestSpecApproval.sequence_number
    ) {
      throw new IpcProtocolError(
        "invalid_request",
        "Start work is already confirmed for the latest approved specs.",
      )
    }

    return this.appendMessage({
      chatId,
      role: "user",
      messageType: "thread_start_request",
      contentMarkdown: "Start work confirmed.",
      structuredPayloadJson: JSON.stringify({
        type: "thread_start_request",
        confirmed: true,
        planApprovalMessageId: latestPlanApproval.id,
        specApprovalMessageId: latestSpecApproval.id,
        threadTitle: input?.threadTitle ?? null,
        threadSummary: input?.threadSummary ?? null,
      }),
    })
  }

  getRuntimeContext(chatId: ChatId): ChatRuntimeContext {
    const chat = this.get(chatId)
    const projectRow = this.database
      .prepare("SELECT root_path FROM projects WHERE id = ?")
      .get(chat.projectId)
    const rootPath = readStringRow(projectRow, "root_path")

    if (!rootPath) {
      throw new IpcProtocolError(
        "internal_error",
        `Project root path missing for chat ${chatId}.`,
      )
    }

    if (!chat.currentSessionId) {
      throw new IpcProtocolError(
        "internal_error",
        `Chat session missing for chat ${chatId}.`,
      )
    }

    const sessionRow = this.database
      .prepare(
        `
          SELECT continuation_prompt
          FROM chat_sessions
          WHERE id = ?
        `,
      )
      .get(chat.currentSessionId) as
      | {
          continuation_prompt: string | null
        }
      | undefined

    return {
      chat,
      projectId: chat.projectId,
      rootPath,
      chatSessionId: chat.currentSessionId,
      continuationPrompt: sessionRow?.continuation_prompt ?? null,
    }
  }

  appendMessage(input: CreateChatMessageInput): ChatMessageSnapshot {
    const context = this.getRuntimeContext(input.chatId)
    const timestamp = this.now()
    const messageId = `chat_msg_${randomUUID()}`
    const sessionId = input.sessionId ?? context.chatSessionId

    this.database
      .prepare(
        `
          INSERT INTO chat_messages (
            id,
            chat_id,
            session_id,
            role,
            message_type,
            content_markdown,
            structured_payload_json,
            provider_message_id,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        messageId,
        input.chatId,
        sessionId,
        input.role,
        input.messageType,
        input.contentMarkdown ?? null,
        input.structuredPayloadJson ?? null,
        input.providerMessageId ?? null,
        timestamp,
      )

    this.touch(input.chatId, timestamp)

    const row = this.database
      .prepare(
        `
          SELECT
            id,
            chat_id,
            session_id,
            role,
            message_type,
            content_markdown,
            structured_payload_json,
            provider_message_id,
            created_at
          FROM chat_messages
          WHERE id = ?
        `,
      )
      .get(messageId) as ChatMessageRow | undefined

    if (!row) {
      throw new IpcProtocolError(
        "internal_error",
        `Message ${messageId} could not be loaded after insert.`,
      )
    }

    const snapshot = mapChatMessageRow(row)
    this.notifyMessageListeners(snapshot)
    return snapshot
  }

  createActionCheckpoint(input: CreateChatActionCheckpointInput): string {
    const context = this.getRuntimeContext(input.chatId)
    const checkpointId = `chat_checkpoint_${randomUUID()}`
    const sessionId = input.sessionId ?? context.chatSessionId

    this.database
      .prepare(
        `
          INSERT INTO chat_action_checkpoints (
            id,
            chat_id,
            session_id,
            active_target_path,
            branch_name,
            worktree_path,
            action_type,
            affected_paths_json,
            command_metadata_json,
            result_summary,
            artifact_refs_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        checkpointId,
        input.chatId,
        sessionId,
        input.activeTargetPath ?? null,
        input.branchName ?? null,
        input.worktreePath ?? null,
        input.actionType,
        JSON.stringify(input.affectedPaths),
        input.commandMetadataJson ?? null,
        input.resultSummary ?? null,
        input.artifactRefsJson ?? null,
        this.now(),
      )

    return checkpointId
  }

  updateSessionContinuationPrompt(
    sessionId: string,
    continuationPrompt: string | null,
  ): void {
    this.database
      .prepare(
        `
          UPDATE chat_sessions
          SET continuation_prompt = ?
          WHERE id = ?
        `,
      )
      .run(continuationPrompt, sessionId)
  }

  touch(chatId: ChatId, timestamp = this.now()): void {
    this.updateChat(chatId, {
      sql: "UPDATE chats SET updated_at = ? WHERE id = ?",
      params: [timestamp, chatId],
    })
  }

  listSessions(chatId: ChatId): ChatSessionSnapshot[] {
    this.get(chatId)

    return this.database
      .prepare(
        `
          SELECT
            id,
            chat_id,
            sequence_number,
            started_at,
            ended_at,
            compaction_source_session_id,
            compaction_summary,
            continuation_prompt
          FROM chat_sessions
          WHERE chat_id = ?
          ORDER BY sequence_number ASC
        `,
      )
      .all(chatId)
      .map((row) => row as ChatSessionRow)
      .map(mapChatSessionRow)
  }

  listMessages(chatId: ChatId): ChatMessageSnapshot[] {
    this.get(chatId)

    return this.database
      .prepare(
        `
          SELECT
            id,
            chat_id,
            session_id,
            role,
            message_type,
            content_markdown,
            structured_payload_json,
            provider_message_id,
            created_at
          FROM chat_messages
          WHERE chat_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(chatId)
      .map((row) => row as ChatMessageRow)
      .map(mapChatMessageRow)
  }

  subscribeToMessages(
    chatId: ChatId,
    listener: (message: ChatMessageSnapshot) => void,
  ): () => void {
    this.get(chatId)
    const listeners = this.messageListenersByChatId.get(chatId) ?? new Set()
    listeners.add(listener)
    this.messageListenersByChatId.set(chatId, listeners)

    return () => {
      const active = this.messageListenersByChatId.get(chatId)

      if (!active) {
        return
      }

      active.delete(listener)

      if (active.size === 0) {
        this.messageListenersByChatId.delete(chatId)
      }
    }
  }

  listThreadRefs(chatId: ChatId): ChatThreadRefSnapshot[] {
    this.get(chatId)

    return this.database
      .prepare(
        `
          SELECT chat_id, thread_id, reference_type, created_at
          FROM chat_thread_refs
          WHERE chat_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(chatId)
      .map((row) => row as ChatThreadRefRow)
      .map(mapChatThreadRefRow)
  }

  listChatRefs(chatId: ChatId): ChatChatRefSnapshot[] {
    this.get(chatId)

    return this.database
      .prepare(
        `
          SELECT source_chat_id, target_chat_id, reference_type, created_at
          FROM chat_chat_refs
          WHERE source_chat_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(chatId)
      .map((row) => row as ChatChatRefRow)
      .map(mapChatChatRefRow)
  }

  getDatabase(): DatabaseSync {
    return this.database
  }

  private assertProjectExists(projectId: ProjectId): void {
    const project = this.database
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(projectId)

    if (!project) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }
  }

  private notifyMessageListeners(message: ChatMessageSnapshot): void {
    const listeners = this.messageListenersByChatId.get(message.chatId)

    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(message)
    }
  }

  private getLatestMessageByType(
    chatId: ChatId,
    messageType: string,
  ): ChatMessageSequenceRow | null {
    this.get(chatId)

    const row = this.database
      .prepare(
        `
          SELECT
            id,
            rowid AS sequence_number
          FROM chat_messages
          WHERE chat_id = ? AND message_type = ?
          ORDER BY rowid DESC
          LIMIT 1
        `,
      )
      .get(chatId, messageType) as ChatMessageSequenceRow | undefined

    return row ?? null
  }

  private updateChat(
    chatId: ChatId,
    statement: { sql: string; params: SQLInputValue[] },
  ): void {
    const result = this.database.prepare(statement.sql).run(...statement.params)

    if (result.changes === 0) {
      throw new IpcProtocolError("not_found", `Chat not found: ${chatId}`)
    }
  }
}
