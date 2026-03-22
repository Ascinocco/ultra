import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import type {
  ChatId,
  ChatTurnEventSnapshot,
  ChatTurnId,
  ChatTurnSnapshot,
  ChatTurnStatus,
  ChatsGetTurnEventsResult,
  ChatsListTurnsResult,
  ChatsStartTurnResult,
} from "@ultra/shared"

import { saveAttachments } from "./attachment-storage.js"
import { IpcProtocolError } from "../ipc/errors.js"
import type {
  ChatMessageSnapshot,
  ChatRuntimeConfig,
  ChatService,
} from "./chat-service.js"
import type { ChatRuntimeRegistry } from "./runtime/chat-runtime-registry.js"
import { buildContinuationPromptFromMessages } from "./runtime/runtime-helpers.js"
import type { ChatRuntimeSessionManager } from "./runtime/runtime-session-manager.js"
import type {
  ChatRuntimeCheckpointCandidate,
  ChatRuntimeEvent,
  ChatRuntimeError,
  ChatRuntimeTurnResult,
} from "./runtime/types.js"
import {
  buildSummaryPrompt,
  getSystemPrompt,
  selectSummaryModel,
} from "./workspace-summary.js"

// Non-tool item types that shouldn't appear in structured blocks
const NON_TOOL_LABELS = new Set([
  "agent_message", "agentMessage", "reasoning", "userMessage", "user_message",
  "command_output", "file_change_output",
])

type StructuredBlock =
  | { type: "text"; content: string }
  | { type: "tools"; tools: Array<{ name: string; detail: string; id?: string | null; subtype?: string }> }

/**
 * Build interleaved text + tool blocks from runtime events for the structured payload.
 */
function buildStructuredBlocks(events: ChatRuntimeEvent[]): StructuredBlock[] {
  const blocks: StructuredBlock[] = []

  function lastBlock(): StructuredBlock | undefined {
    return blocks[blocks.length - 1]
  }

  for (const event of events) {
    if (event.type === "assistant_delta") {
      const last = lastBlock()
      if (last?.type === "text") {
        last.content += event.text
      } else {
        blocks.push({ type: "text", content: event.text })
      }
    } else if (event.type === "tool_activity" && event.label === "AskUserQuestion") {
      const questionText = extractToolDetail("AskUserQuestion", event.metadata)
      if (questionText) {
        const last = lastBlock()
        if (last?.type === "text") {
          last.content += "\n\n" + questionText
        } else {
          blocks.push({ type: "text", content: questionText })
        }
      }
    } else if (event.type === "tool_activity" && !NON_TOOL_LABELS.has(event.label)) {
      const detail = extractToolDetail(event.label, event.metadata)
      const toolId = (event.metadata as any)?.id ?? (event.metadata as any)?.item?.id ?? null
      const subtype = event.label === "Skill" ? "skill" : undefined
      const last = lastBlock()

      // Deduplicate: if a tool with the same ID exists in the current group, update it
      if (toolId && last?.type === "tools") {
        const existing = last.tools.find((t) => t.id === toolId)
        if (existing) {
          if (detail) existing.detail = detail
          continue
        }
      }

      if (last?.type === "tools") {
        last.tools.push({ name: event.label, detail, id: toolId, subtype })
      } else {
        blocks.push({ type: "tools", tools: [{ name: event.label, detail, id: toolId, subtype }] })
      }
    }
  }

  // Only return blocks if there are tool entries (otherwise no structured payload needed)
  return blocks.some((b) => b.type === "tools") ? blocks : []
}

function extractToolDetail(label: string, metadata?: Record<string, unknown>): string {
  if (!metadata) return ""
  const m = metadata as any
  switch (label) {
    case "bash":
    case "commandExecution":
    case "command_execution":
      return m?.input?.command ?? m?.item?.command ?? ""
    case "Read":
    case "fileRead":
    case "file_read":
      return m?.input?.file_path ?? m?.item?.path ?? ""
    case "Edit":
    case "Write":
    case "fileChange":
    case "file_change":
      return m?.input?.file_path ?? m?.item?.path ?? ""
    case "Grep":
    case "Glob":
      return m?.input?.pattern ?? ""
    case "AskUserQuestion":
      return m?.input?.question ?? m?.input?.text ?? ""
    case "Skill":
      return m?.input?.skill ?? ""
    default:
      return ""
  }
}

type ChatTurnRow = {
  turn_id: string
  chat_id: string
  session_id: string
  client_turn_id: string | null
  user_message_id: string
  assistant_message_id: string | null
  status: ChatTurnStatus
  provider: "codex" | "claude"
  model: string
  vendor_session_id: string | null
  started_at: string
  updated_at: string
  completed_at: string | null
  failure_code: string | null
  failure_message: string | null
  cancel_requested_at: string | null
}

type ChatTurnEventRow = {
  event_id: string
  chat_id: string
  turn_id: string
  sequence_number: number
  event_type: string
  payload_json: string
  source: string
  actor_type: string
  actor_id: string | null
  occurred_at: string
  recorded_at: string
}

type ChatTurnEventListener = {
  listener: (event: ChatTurnEventSnapshot) => void
  turnId: ChatTurnId | null
}

type ActiveTurnRow = {
  turn_id: string
  status: ChatTurnStatus
}

type QueuedTurnRow = {
  turn_id: string
  prompt: string
}

type ClaimedTurn = {
  turnId: ChatTurnId
  prompt: string
  attachments?: Array<{ type: "image" | "text"; name: string; media_type: string; data: string }>
  events: ChatTurnEventSnapshot[]
}

export type ChatTurnResult = {
  userMessage: ChatMessageSnapshot
  assistantMessage: ChatMessageSnapshot
  checkpointIds: string[]
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value)
}

function readChatTurnRow(result: unknown): ChatTurnRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ChatTurnRow
}

function readChatTurnEventRow(result: unknown): ChatTurnEventRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ChatTurnEventRow
}

function parseEventPayload(payloadJson: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadJson) as unknown

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Chat turn event payload JSON must decode to an object.")
  }

  return parsed as Record<string, unknown>
}

function mapChatTurnRow(row: ChatTurnRow): ChatTurnSnapshot {
  return {
    turnId: row.turn_id,
    chatId: row.chat_id,
    sessionId: row.session_id,
    clientTurnId: row.client_turn_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    vendorSessionId: row.vendor_session_id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    cancelRequestedAt: row.cancel_requested_at,
  }
}

function mapChatTurnEventRow(row: ChatTurnEventRow): ChatTurnEventSnapshot {
  return {
    eventId: row.event_id,
    chatId: row.chat_id,
    turnId: row.turn_id,
    sequenceNumber: row.sequence_number,
    eventType: row.event_type,
    source: row.source,
    actorType: row.actor_type,
    actorId: row.actor_id,
    payload: parseEventPayload(row.payload_json),
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  }
}

export class ChatTurnService {
  private readonly turnEventListenersByChatId = new Map<
    ChatId,
    Set<ChatTurnEventListener>
  >()
  private readonly processingChatIds = new Set<ChatId>()
  private readonly pendingAttachments = new Map<string, Array<{ type: "image" | "text"; name: string; media_type: string; data: string }>>()
  private readonly turnAbortControllers = new Map<string, AbortController>()

  constructor(
    private readonly chatService: ChatService,
    private readonly runtimeRegistry: ChatRuntimeRegistry,
    private readonly sessionManager: ChatRuntimeSessionManager,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    const recoveredEvents = this.failStaleRunningTurns()
    this.notifyTurnEvents(recoveredEvents)

    for (const chatId of this.listQueuedChatIds()) {
      this.scheduleTurnProcessing(chatId)
    }
  }

  startTurn(input: {
    chatId: ChatId
    prompt: string
    clientTurnId?: string
    attachments?: Array<{ type: "image" | "text"; name: string; media_type: string; data: string }>
  }): ChatsStartTurnResult {
    const normalizedPrompt = input.prompt.trim()
    if (normalizedPrompt.length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Chat prompt must not be empty.",
      )
    }

    const runtimeContext = this.chatService.getRuntimeContext(input.chatId)
    const database = this.chatService.getDatabase()
    const clientTurnId = input.clientTurnId?.trim() || null

    if (clientTurnId) {
      const existing = readChatTurnRow(
        database
          .prepare(
            `
              SELECT
                turn_id,
                chat_id,
                session_id,
                client_turn_id,
                user_message_id,
                assistant_message_id,
                status,
                provider,
                model,
                vendor_session_id,
                started_at,
                updated_at,
                completed_at,
                failure_code,
                failure_message,
                cancel_requested_at
              FROM chat_turns
              WHERE chat_id = ? AND client_turn_id = ?
            `,
          )
          .get(input.chatId, clientTurnId),
      )

      if (existing) {
        if (existing.status === "queued") {
          this.scheduleTurnProcessing(input.chatId)
        }
        return {
          accepted: true,
          turn: mapChatTurnRow(existing),
        }
      }
    }

    const turnId = `chat_turn_${randomUUID()}`
    const timestamp = this.now()
    let queuedEvent: ChatTurnEventSnapshot

    database.exec("BEGIN")
    try {
      this.assertNoActiveTurnForChat(input.chatId, database)

      const attachmentMeta = input.attachments && input.attachments.length > 0
        ? input.attachments.map((a) => ({ name: a.name, type: a.type, media_type: a.media_type }))
        : undefined

      const userMessage = this.chatService.appendMessage({
        chatId: input.chatId,
        role: "user",
        messageType: "user_text",
        contentMarkdown: normalizedPrompt,
        ...(attachmentMeta ? {
          structuredPayloadJson: JSON.stringify({ attachments: attachmentMeta }),
        } : {}),
      })

      database
        .prepare(
          `
            INSERT INTO chat_turns (
              turn_id,
              chat_id,
              session_id,
              client_turn_id,
              user_message_id,
              assistant_message_id,
              status,
              provider,
              model,
              vendor_session_id,
              started_at,
              updated_at,
              completed_at,
              failure_code,
              failure_message,
              cancel_requested_at
            ) VALUES (?, ?, ?, ?, ?, NULL, 'queued', ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL)
          `,
        )
        .run(
          turnId,
          input.chatId,
          runtimeContext.chatSessionId,
          clientTurnId,
          userMessage.id,
          runtimeContext.chat.provider,
          runtimeContext.chat.model,
          timestamp,
          timestamp,
        )

      queuedEvent = this.appendTurnEventInternal({
        chatId: input.chatId,
        turnId,
        eventType: "chat.turn_queued",
        source: "api",
        actorType: "user",
        actorId: null,
        payload: {
          prompt: normalizedPrompt,
          user_message_id: userMessage.id,
        },
        occurredAt: timestamp,
        recordedAt: timestamp,
      })
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }

    if (input.attachments && input.attachments.length > 0) {
      this.pendingAttachments.set(turnId, input.attachments)
      // Persist to disk so attachments survive for thread promotion
      const userMsgId = (queuedEvent.payload as { user_message_id?: string }).user_message_id
      if (userMsgId) saveAttachments(userMsgId, input.attachments)
    }

    this.notifyTurnEventListeners(queuedEvent)
    this.scheduleTurnProcessing(input.chatId)

    return {
      accepted: true,
      turn: this.getTurn(input.chatId, turnId),
    }
  }

  cancelTurn(chatId: ChatId, turnId: ChatTurnId): ChatTurnSnapshot {
    const current = this.getTurn(chatId, turnId)
    if (
      current.status === "succeeded" ||
      current.status === "failed" ||
      current.status === "canceled"
    ) {
      return current
    }
    if (current.status === "running" && current.cancelRequestedAt) {
      return current
    }

    const database = this.chatService.getDatabase()
    const timestamp = this.now()
    const eventsToNotify: ChatTurnEventSnapshot[] = []

    database.exec("BEGIN")
    try {
      if (current.status === "queued") {
        database
          .prepare(
            `
              UPDATE chat_turns
              SET
                status = 'canceled',
                cancel_requested_at = COALESCE(cancel_requested_at, ?),
                completed_at = COALESCE(completed_at, ?),
                updated_at = ?
              WHERE turn_id = ? AND chat_id = ?
            `,
          )
          .run(timestamp, timestamp, timestamp, turnId, chatId)

        eventsToNotify.push(
          this.appendTurnEventInternal({
            chatId,
            turnId,
            eventType: "chat.turn_canceled",
            source: "api",
            actorType: "user",
            actorId: null,
            payload: { reason: "cancel_requested" },
            occurredAt: timestamp,
            recordedAt: timestamp,
          }),
        )
      } else {
        database
          .prepare(
            `
              UPDATE chat_turns
              SET
                cancel_requested_at = COALESCE(cancel_requested_at, ?),
                updated_at = ?
              WHERE turn_id = ? AND chat_id = ? AND status = 'running'
            `,
          )
          .run(timestamp, timestamp, turnId, chatId)

        eventsToNotify.push(
          this.appendTurnEventInternal({
            chatId,
            turnId,
            eventType: "chat.turn_progress",
            source: "api",
            actorType: "user",
            actorId: null,
            payload: { stage: "cancel_requested" },
            occurredAt: timestamp,
            recordedAt: timestamp,
          }),
        )
      }
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }

    this.notifyTurnEvents(eventsToNotify)

    // Kill the running subprocess
    const controller = this.turnAbortControllers.get(turnId)
    if (controller) {
      controller.abort()
    }

    return this.getTurn(chatId, turnId)
  }

  getTurn(chatId: ChatId, turnId: ChatTurnId): ChatTurnSnapshot {
    this.chatService.get(chatId)
    const row = readChatTurnRow(
      this.chatService
        .getDatabase()
        .prepare(
          `
            SELECT
              turn_id,
              chat_id,
              session_id,
              client_turn_id,
              user_message_id,
              assistant_message_id,
              status,
              provider,
              model,
              vendor_session_id,
              started_at,
              updated_at,
              completed_at,
              failure_code,
              failure_message,
              cancel_requested_at
            FROM chat_turns
            WHERE turn_id = ? AND chat_id = ?
          `,
        )
        .get(turnId, chatId),
    )

    if (!row) {
      throw new IpcProtocolError(
        "not_found",
        `Chat turn not found: ${turnId} in chat ${chatId}`,
      )
    }

    return mapChatTurnRow(row)
  }

  listTurns(input: {
    chatId: ChatId
    limit?: number
    cursor?: string
  }): ChatsListTurnsResult {
    this.chatService.get(input.chatId)
    const database = this.chatService.getDatabase()
    const limit = input.limit ?? 20

    let cursorRow: ChatTurnRow | null = null
    if (input.cursor) {
      cursorRow = readChatTurnRow(
        database
          .prepare(
            `
              SELECT
                turn_id,
                chat_id,
                session_id,
                client_turn_id,
                user_message_id,
                assistant_message_id,
                status,
                provider,
                model,
                vendor_session_id,
                started_at,
                updated_at,
                completed_at,
                failure_code,
                failure_message,
                cancel_requested_at
              FROM chat_turns
              WHERE chat_id = ? AND turn_id = ?
            `,
          )
          .get(input.chatId, input.cursor),
      )

      if (!cursorRow) {
        throw new IpcProtocolError(
          "invalid_request",
          `Cursor does not reference a known turn for chat ${input.chatId}.`,
        )
      }
    }

    const rows = (
      cursorRow
        ? database
            .prepare(
              `
                SELECT
                  turn_id,
                  chat_id,
                  session_id,
                  client_turn_id,
                  user_message_id,
                  assistant_message_id,
                  status,
                  provider,
                  model,
                  vendor_session_id,
                  started_at,
                  updated_at,
                  completed_at,
                  failure_code,
                  failure_message,
                  cancel_requested_at
                FROM chat_turns
                WHERE chat_id = ?
                  AND (
                    started_at < ?
                    OR (started_at = ? AND turn_id < ?)
                  )
                ORDER BY started_at DESC, turn_id DESC
                LIMIT ?
              `,
            )
            .all(
              input.chatId,
              cursorRow.started_at,
              cursorRow.started_at,
              cursorRow.turn_id,
              limit + 1,
            )
        : database
            .prepare(
              `
                SELECT
                  turn_id,
                  chat_id,
                  session_id,
                  client_turn_id,
                  user_message_id,
                  assistant_message_id,
                  status,
                  provider,
                  model,
                  vendor_session_id,
                  started_at,
                  updated_at,
                  completed_at,
                  failure_code,
                  failure_message,
                  cancel_requested_at
                FROM chat_turns
                WHERE chat_id = ?
                ORDER BY started_at DESC, turn_id DESC
                LIMIT ?
              `,
            )
            .all(input.chatId, limit + 1)
    ) as ChatTurnRow[]

    const hasMore = rows.length > limit
    const visibleRows = hasMore ? rows.slice(0, limit) : rows
    const turns = visibleRows.map((row) => mapChatTurnRow(row))

    return {
      turns,
      nextCursor: hasMore ? turns[turns.length - 1]?.turnId ?? null : null,
    }
  }

  getTurnEvents(
    chatId: ChatId,
    turnId: ChatTurnId,
    fromSequence?: number,
  ): ChatsGetTurnEventsResult {
    this.getTurn(chatId, turnId)
    const database = this.chatService.getDatabase()
    const rows = (
      fromSequence
        ? database
            .prepare(
              `
                SELECT
                  event_id,
                  chat_id,
                  turn_id,
                  sequence_number,
                  event_type,
                  payload_json,
                  source,
                  actor_type,
                  actor_id,
                  occurred_at,
                  recorded_at
                FROM chat_turn_events
                WHERE chat_id = ? AND turn_id = ? AND sequence_number > ?
                ORDER BY sequence_number ASC
              `,
            )
            .all(chatId, turnId, fromSequence)
        : database
            .prepare(
              `
                SELECT
                  event_id,
                  chat_id,
                  turn_id,
                  sequence_number,
                  event_type,
                  payload_json,
                  source,
                  actor_type,
                  actor_id,
                  occurred_at,
                  recorded_at
                FROM chat_turn_events
                WHERE chat_id = ? AND turn_id = ?
                ORDER BY sequence_number ASC
              `,
            )
            .all(chatId, turnId)
    ) as ChatTurnEventRow[]

    return {
      events: rows.map((row) => mapChatTurnEventRow(row)),
    }
  }

  subscribeToTurnEvents(
    input: { chatId: ChatId; turnId?: ChatTurnId },
    listener: (event: ChatTurnEventSnapshot) => void,
  ): () => void {
    this.chatService.get(input.chatId)
    if (input.turnId) {
      this.getTurn(input.chatId, input.turnId)
    }

    const listeners =
      this.turnEventListenersByChatId.get(input.chatId) ?? new Set()
    const entry: ChatTurnEventListener = {
      listener,
      turnId: input.turnId ?? null,
    }
    listeners.add(entry)
    this.turnEventListenersByChatId.set(input.chatId, listeners)

    return () => {
      const active = this.turnEventListenersByChatId.get(input.chatId)
      if (!active) {
        return
      }

      active.delete(entry)
      if (active.size === 0) {
        this.turnEventListenersByChatId.delete(input.chatId)
      }
    }
  }

  async sendMessage(chatId: ChatId, prompt: string): Promise<ChatTurnResult> {
    const normalizedPrompt = prompt.trim()

    if (normalizedPrompt.length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Chat prompt must not be empty.",
      )
    }

    const userMessage = this.chatService.appendMessage({
      chatId,
      role: "user",
      messageType: "user_text",
      contentMarkdown: normalizedPrompt,
    })

    const initialContext = this.chatService.getRuntimeContext(chatId)
    const session = this.sessionManager.getSession(
      chatId,
      initialContext.chatSessionId,
      this.extractConfig(initialContext.chat),
      initialContext.rootPath,
    )
    const seedMessages = this.chatService.listMessages(chatId)

    try {
      const result = await this.runTurnWithRecovery(
        initialContext.chat,
        initialContext.rootPath,
        initialContext.chatSessionId,
        normalizedPrompt,
        initialContext.continuationPrompt,
        seedMessages,
        session?.vendorSessionId ?? null,
      )

      const assistantMessage = this.chatService.appendMessage({
        chatId,
        role: "assistant",
        messageType: "assistant_text",
        contentMarkdown: result.finalText,
        providerMessageId: result.vendorSessionId,
      })
      this.sessionManager.saveSession({
        chatId,
        chatSessionId: initialContext.chatSessionId,
        provider: initialContext.chat.provider,
        model: initialContext.chat.model,
        thinkingLevel: initialContext.chat.thinkingLevel,
        permissionLevel: initialContext.chat.permissionLevel,
        cwd: initialContext.rootPath,
        vendorSessionId: result.vendorSessionId,
        lastActivityAt: this.now(),
      })
      const checkpointIds = this.persistCheckpointCandidates(
        chatId,
        result.events
          .filter((event) => event.type === "checkpoint_candidate")
          .map((event) => event.checkpoint),
      )
      const continuationPrompt = buildContinuationPromptFromMessages(
        this.chatService.listMessages(chatId),
      )

      this.chatService.updateSessionContinuationPrompt(
        initialContext.chatSessionId,
        continuationPrompt,
      )
      this.chatService.touch(chatId, this.now())

      return {
        userMessage,
        assistantMessage,
        checkpointIds,
      }
    } catch (error) {
      if (this.isRuntimeError(error)) {
        throw this.mapRuntimeError(error)
      }

      throw error
    }
  }

  private assertNoActiveTurnForChat(
    chatId: ChatId,
    database = this.chatService.getDatabase(),
  ): void {
    const activeTurn = this.findActiveTurnForChat(chatId, database)
    if (!activeTurn) {
      return
    }

    throw new IpcProtocolError(
      "conflict",
      `Chat ${chatId} already has an active turn (${activeTurn.turn_id}) with status ${activeTurn.status}.`,
    )
  }

  private findActiveTurnForChat(
    chatId: ChatId,
    database = this.chatService.getDatabase(),
  ): ActiveTurnRow | null {
    const active = database
      .prepare(
        `
          SELECT turn_id, status
          FROM chat_turns
          WHERE chat_id = ? AND status IN ('queued', 'running')
          ORDER BY started_at ASC, turn_id ASC
          LIMIT 1
        `,
      )
      .get(chatId)

    if (!active || typeof active !== "object") {
      return null
    }

    return active as ActiveTurnRow
  }

  private scheduleTurnProcessing(chatId: ChatId): void {
    if (this.processingChatIds.has(chatId)) {
      return
    }

    this.processingChatIds.add(chatId)
    queueMicrotask(() => {
      void this.processTurnQueue(chatId)
    })
  }

  private async processTurnQueue(chatId: ChatId): Promise<void> {
    try {
      while (true) {
        const claimed = this.claimNextQueuedTurn(chatId)
        if (!claimed) {
          break
        }

        this.notifyTurnEvents(claimed.events)
        await this.executeClaimedTurn(chatId, claimed)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(
        `[backend] chat turn orchestrator failed for chat ${chatId}: ${reason}`,
      )
    } finally {
      this.processingChatIds.delete(chatId)
      if (this.hasQueuedTurns(chatId) && !this.hasRunningTurn(chatId)) {
        this.scheduleTurnProcessing(chatId)
      }
    }
  }

  private claimNextQueuedTurn(chatId: ChatId): ClaimedTurn | null {
    const database = this.chatService.getDatabase()
    const runningTurn = this.findActiveTurnForChat(chatId, database)
    if (runningTurn && runningTurn.status === "running") {
      return null
    }

    database.exec("BEGIN")
    try {
      const nextQueued = database
        .prepare(
          `
            SELECT
              turns.turn_id,
              COALESCE(messages.content_markdown, '') AS prompt
            FROM chat_turns AS turns
            INNER JOIN chat_messages AS messages
              ON messages.id = turns.user_message_id
            WHERE turns.chat_id = ? AND turns.status = 'queued'
            ORDER BY turns.started_at ASC, turns.turn_id ASC
            LIMIT 1
          `,
        )
        .get(chatId) as QueuedTurnRow | undefined

      if (!nextQueued) {
        database.exec("COMMIT")
        return null
      }

      const timestamp = this.now()
      const updateResult = database
        .prepare(
          `
            UPDATE chat_turns
            SET status = 'running', updated_at = ?
            WHERE turn_id = ? AND chat_id = ? AND status = 'queued'
          `,
        )
        .run(timestamp, nextQueued.turn_id, chatId) as { changes: number }

      if (updateResult.changes === 0) {
        database.exec("ROLLBACK")
        return null
      }

      const startedEvent = this.appendTurnEventInternal({
        chatId,
        turnId: nextQueued.turn_id,
        eventType: "chat.turn_started",
        source: "system",
        actorType: "system",
        actorId: null,
        payload: {
          status: "running",
        },
        occurredAt: timestamp,
        recordedAt: timestamp,
      })
      const progressEvent = this.appendTurnEventInternal({
        chatId,
        turnId: nextQueued.turn_id,
        eventType: "chat.turn_progress",
        source: "system",
        actorType: "system",
        actorId: null,
        payload: {
          stage: "runtime_started",
        },
        occurredAt: timestamp,
        recordedAt: timestamp,
      })
      database.exec("COMMIT")

      const attachments = this.pendingAttachments.get(nextQueued.turn_id)
      if (attachments) {
        this.pendingAttachments.delete(nextQueued.turn_id)
      }

      return {
        turnId: nextQueued.turn_id,
        prompt: nextQueued.prompt,
        attachments,
        events: [startedEvent, progressEvent],
      }
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }

  private async executeClaimedTurn(
    chatId: ChatId,
    claimed: ClaimedTurn,
  ): Promise<void> {
    const runtimeContext = this.chatService.getRuntimeContext(chatId)
    const session = this.sessionManager.getSession(
      chatId,
      runtimeContext.chatSessionId,
      this.extractConfig(runtimeContext.chat),
      runtimeContext.rootPath,
    )
    const seedMessages = this.chatService.listMessages(chatId)

    const abortController = new AbortController()
    this.turnAbortControllers.set(claimed.turnId, abortController)

    try {
      const timestamp = new Date().toISOString()
      const streamingOnEvent = (runtimeEvent: ChatRuntimeEvent) => {
        const mapped = this.mapRuntimeEventToTurnEvent(runtimeEvent)
        const persisted = this.appendTurnEventInternal({
          chatId,
          turnId: claimed.turnId,
          eventType: mapped.eventType,
          source: "runtime",
          actorType: "assistant",
          actorId: null,
          payload: mapped.payload,
          occurredAt: timestamp,
          recordedAt: timestamp,
        })
        this.notifyTurnEventListeners(persisted)
      }

      const result = await this.runTurnWithRecovery(
        runtimeContext.chat,
        runtimeContext.rootPath,
        runtimeContext.chatSessionId,
        claimed.prompt,
        runtimeContext.continuationPrompt,
        seedMessages,
        session?.vendorSessionId ?? null,
        abortController.signal,
        streamingOnEvent,
        claimed.attachments,
      )

      this.notifyTurnEvents(
        this.finalizeSucceededTurn({
          chatId,
          turnId: claimed.turnId,
          runtimeContext,
          result,
          eventsAlreadyStreamed: true,
        }),
      )

      // Fire-and-forget workspace description update
      this.updateWorkspaceDescription(chatId).catch(() => {
        // Silently ignore summary generation failures
      })
    } catch (error) {
      this.notifyTurnEvents(this.finalizeFailedTurn(chatId, claimed.turnId, error))
    } finally {
      this.turnAbortControllers.delete(claimed.turnId)
    }
  }

  private finalizeSucceededTurn(input: {
    chatId: ChatId
    turnId: ChatTurnId
    runtimeContext: ReturnType<ChatService["getRuntimeContext"]>
    result: ChatRuntimeTurnResult
    eventsAlreadyStreamed?: boolean
  }): ChatTurnEventSnapshot[] {
    const current = this.getTurn(input.chatId, input.turnId)
    if (current.status !== "running") {
      return []
    }

    if (current.cancelRequestedAt) {
      return this.finalizeCanceledRunningTurn(
        input.chatId,
        input.turnId,
        "cancel_requested",
      )
    }

    const database = this.chatService.getDatabase()
    const timestamp = this.now()
    const eventsToNotify: ChatTurnEventSnapshot[] = []

    database.exec("BEGIN")
    try {
      if (input.eventsAlreadyStreamed) {
        // Only persist non-streamed events (assistant_final is added after process completes)
        const nonStreamedEvents = input.result.events.filter(
          (e) => e.type === "assistant_final"
        )
        eventsToNotify.push(
          ...this.appendRuntimeEvents(
            input.chatId,
            input.turnId,
            nonStreamedEvents,
            timestamp,
          ),
        )
      } else {
        // Original batch path
        eventsToNotify.push(
          ...this.appendRuntimeEvents(
            input.chatId,
            input.turnId,
            input.result.events,
            timestamp,
          ),
        )
      }

      const structuredBlocks = buildStructuredBlocks(input.result.events)
      const assistantMessage = this.chatService.appendMessage({
        chatId: input.chatId,
        role: "assistant",
        messageType: "assistant_text",
        contentMarkdown: input.result.finalText,
        structuredPayloadJson: structuredBlocks.length > 0
          ? JSON.stringify({ blocks: structuredBlocks })
          : null,
        providerMessageId: input.result.vendorSessionId,
      })

      this.sessionManager.saveSession({
        chatId: input.chatId,
        chatSessionId: input.runtimeContext.chatSessionId,
        provider: input.runtimeContext.chat.provider,
        model: input.runtimeContext.chat.model,
        thinkingLevel: input.runtimeContext.chat.thinkingLevel,
        permissionLevel: input.runtimeContext.chat.permissionLevel,
        cwd: input.runtimeContext.rootPath,
        vendorSessionId: input.result.vendorSessionId,
        lastActivityAt: this.now(),
      })

      const checkpointIds = this.persistCheckpointCandidates(
        input.chatId,
        input.result.events
          .filter((event) => event.type === "checkpoint_candidate")
          .map((event) => event.checkpoint),
      )
      const continuationPrompt = buildContinuationPromptFromMessages(
        this.chatService.listMessages(input.chatId),
      )

      this.chatService.updateSessionContinuationPrompt(
        input.runtimeContext.chatSessionId,
        continuationPrompt,
      )
      this.chatService.touch(input.chatId, this.now())

      const updateResult = database
        .prepare(
          `
            UPDATE chat_turns
            SET
              status = 'succeeded',
              assistant_message_id = ?,
              vendor_session_id = ?,
              completed_at = ?,
              updated_at = ?,
              failure_code = NULL,
              failure_message = NULL
            WHERE turn_id = ? AND chat_id = ? AND status = 'running'
          `,
        )
        .run(
          assistantMessage.id,
          input.result.vendorSessionId,
          timestamp,
          timestamp,
          input.turnId,
          input.chatId,
        ) as { changes: number }

      if (updateResult.changes === 0) {
        database.exec("ROLLBACK")
        return []
      }

      eventsToNotify.push(
        this.appendTurnEventInternal({
          chatId: input.chatId,
          turnId: input.turnId,
          eventType: "chat.turn_completed",
          source: "runtime",
          actorType: "assistant",
          actorId: null,
          payload: {
            assistant_message_id: assistantMessage.id,
            checkpoint_ids: checkpointIds,
            vendor_session_id: input.result.vendorSessionId,
            finished_reason: "runtime_completed",
            resumed: input.result.resumed,
          },
          occurredAt: timestamp,
          recordedAt: timestamp,
        }),
      )

      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }

    return eventsToNotify
  }

  private finalizeCanceledRunningTurn(
    chatId: ChatId,
    turnId: ChatTurnId,
    reason: string,
  ): ChatTurnEventSnapshot[] {
    const database = this.chatService.getDatabase()
    const timestamp = this.now()

    database.exec("BEGIN")
    try {
      const updateResult = database
        .prepare(
          `
            UPDATE chat_turns
            SET
              status = 'canceled',
              cancel_requested_at = COALESCE(cancel_requested_at, ?),
              completed_at = COALESCE(completed_at, ?),
              updated_at = ?,
              failure_code = NULL,
              failure_message = NULL
            WHERE turn_id = ? AND chat_id = ? AND status = 'running'
          `,
        )
        .run(timestamp, timestamp, timestamp, turnId, chatId) as {
        changes: number
      }

      if (updateResult.changes === 0) {
        database.exec("ROLLBACK")
        return []
      }

      const canceledEvent = this.appendTurnEventInternal({
        chatId,
        turnId,
        eventType: "chat.turn_canceled",
        source: "runtime",
        actorType: "system",
        actorId: null,
        payload: { reason },
        occurredAt: timestamp,
        recordedAt: timestamp,
      })
      database.exec("COMMIT")
      return [canceledEvent]
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }

  private finalizeFailedTurn(
    chatId: ChatId,
    turnId: ChatTurnId,
    error: unknown,
  ): ChatTurnEventSnapshot[] {
    const current = this.getTurn(chatId, turnId)
    if (current.status !== "running") {
      return []
    }
    if (current.cancelRequestedAt) {
      return this.finalizeCanceledRunningTurn(chatId, turnId, "cancel_requested")
    }

    const database = this.chatService.getDatabase()
    const timestamp = this.now()
    const failure = this.mapTurnFailure(error, current.provider)

    database.exec("BEGIN")
    try {
      const updateResult = database
        .prepare(
          `
            UPDATE chat_turns
            SET
              status = 'failed',
              failure_code = ?,
              failure_message = ?,
              completed_at = ?,
              updated_at = ?
            WHERE turn_id = ? AND chat_id = ? AND status = 'running'
          `,
        )
        .run(
          failure.code,
          failure.message,
          timestamp,
          timestamp,
          turnId,
          chatId,
        ) as { changes: number }

      if (updateResult.changes === 0) {
        database.exec("ROLLBACK")
        return []
      }

      const failedEvent = this.appendTurnEventInternal({
        chatId,
        turnId,
        eventType: "chat.turn_failed",
        source: "runtime",
        actorType: "system",
        actorId: null,
        payload: {
          code: failure.code,
          message: failure.message,
          details: failure.details ?? null,
        },
        occurredAt: timestamp,
        recordedAt: timestamp,
      })

      database.exec("COMMIT")
      return [failedEvent]
    } catch (finalizeError) {
      database.exec("ROLLBACK")
      throw finalizeError
    }
  }

  private appendRuntimeEvents(
    chatId: ChatId,
    turnId: ChatTurnId,
    runtimeEvents: ChatRuntimeEvent[],
    occurredAt: string,
  ): ChatTurnEventSnapshot[] {
    const turnEvents: ChatTurnEventSnapshot[] = []
    for (const runtimeEvent of runtimeEvents) {
      const mapped = this.mapRuntimeEventToTurnEvent(runtimeEvent)
      turnEvents.push(
        this.appendTurnEventInternal({
          chatId,
          turnId,
          eventType: mapped.eventType,
          source: "runtime",
          actorType: "assistant",
          actorId: null,
          payload: mapped.payload,
          occurredAt,
          recordedAt: occurredAt,
        }),
      )
    }

    return turnEvents
  }

  private mapRuntimeEventToTurnEvent(event: ChatRuntimeEvent): {
    eventType: string
    payload: Record<string, unknown>
  } {
    switch (event.type) {
      case "assistant_delta":
        return {
          eventType: "chat.turn_assistant_delta",
          payload: { text: event.text },
        }
      case "assistant_final":
        return {
          eventType: "chat.turn_progress",
          payload: { stage: "assistant_final", text: event.text },
        }
      case "tool_activity":
        return {
          eventType: "chat.turn_progress",
          payload: {
            stage: "tool_activity",
            label: event.label,
            metadata: event.metadata ?? null,
          },
        }
      case "checkpoint_candidate":
        return {
          eventType: "chat.turn_checkpoint_candidate",
          payload: {
            checkpoint: event.checkpoint,
          },
        }
      case "runtime_notice":
        return {
          eventType: "chat.turn_progress",
          payload: {
            stage: "runtime_notice",
            message: event.message,
          },
        }
      case "runtime_error":
        return {
          eventType: "chat.turn_progress",
          payload: {
            stage: "runtime_error",
            message: event.message,
          },
        }
      case "task_update":
        return {
          eventType: "chat.turn_progress",
          payload: {
            stage: "task_update",
            label: event.label,
            metadata: event.metadata ?? null,
          },
        }
    }
  }

  private mapTurnFailure(
    error: unknown,
    provider: ChatRuntimeConfig["provider"],
  ): {
    code: string
    message: string
    details?: unknown
  } {
    if (this.isRuntimeError(error)) {
      const mapped = this.mapRuntimeError(error)
      return {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
      }
    }

    if (error instanceof IpcProtocolError) {
      return {
        code: error.code,
        message: error.message,
        details: error.details,
      }
    }

    if (this.isMissingRuntimeBinaryError(error)) {
      return this.buildMissingRuntimeFailure(provider, error)
    }

    if (error instanceof Error) {
      return {
        code: "internal_error",
        message: error.message,
      }
    }

    return {
      code: "internal_error",
      message: String(error),
    }
  }

  private isMissingRuntimeBinaryError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false
    }

    const maybeError = error as NodeJS.ErrnoException
    if (maybeError.code === "ENOENT") {
      return true
    }

    return /\bENOENT\b/u.test(error.message)
  }

  private buildMissingRuntimeFailure(
    provider: ChatRuntimeConfig["provider"],
    error: Error,
  ): { code: string; message: string; details: Record<string, unknown> } {
    const command = this.resolveMissingRuntimeCommand(error, provider)
    const runtimeLabel = provider === "codex" ? "Codex" : "Claude"
    const installHint =
      provider === "codex"
        ? "Install Codex CLI and ensure `codex` is on PATH."
        : "Install Claude Code and ensure `claude` is on PATH."

    return {
      code: "runtime_unavailable",
      message: `${runtimeLabel} runtime is unavailable because '${command}' was not found on PATH. ${installHint}`,
      details: {
        provider,
        command,
        cause: error.message,
      },
    }
  }

  private resolveMissingRuntimeCommand(
    error: Error,
    provider: ChatRuntimeConfig["provider"],
  ): string {
    const maybeError = error as NodeJS.ErrnoException
    if (typeof maybeError.path === "string" && maybeError.path.trim().length > 0) {
      return maybeError.path.trim()
    }

    const messageMatch = error.message.match(/spawn\s+([^\s]+)\s+ENOENT/iu)
    if (messageMatch?.[1]) {
      return messageMatch[1]
    }

    return provider
  }

  private failStaleRunningTurns(): ChatTurnEventSnapshot[] {
    const database = this.chatService.getDatabase()
    const runningTurns = database
      .prepare(
        `
          SELECT chat_id, turn_id
          FROM chat_turns
          WHERE status = 'running'
          ORDER BY started_at ASC, turn_id ASC
        `,
      )
      .all() as Array<{ chat_id: string; turn_id: string }>

    const recoveredEvents: ChatTurnEventSnapshot[] = []
    for (const runningTurn of runningTurns) {
      const timestamp = this.now()
      database.exec("BEGIN")
      try {
        const updateResult = database
          .prepare(
            `
              UPDATE chat_turns
              SET
                status = 'failed',
                failure_code = 'backend_restart',
                failure_message = 'Chat turn interrupted by backend restart before completion.',
                completed_at = COALESCE(completed_at, ?),
                updated_at = ?
              WHERE turn_id = ? AND chat_id = ? AND status = 'running'
            `,
          )
          .run(
            timestamp,
            timestamp,
            runningTurn.turn_id,
            runningTurn.chat_id,
          ) as { changes: number }

        if (updateResult.changes === 0) {
          database.exec("ROLLBACK")
          continue
        }

        recoveredEvents.push(
          this.appendTurnEventInternal({
            chatId: runningTurn.chat_id,
            turnId: runningTurn.turn_id,
            eventType: "chat.turn_failed",
            source: "system",
            actorType: "system",
            actorId: null,
            payload: {
              code: "backend_restart",
              message:
                "Chat turn interrupted by backend restart before completion.",
            },
            occurredAt: timestamp,
            recordedAt: timestamp,
          }),
        )
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    }

    return recoveredEvents
  }

  private listQueuedChatIds(): ChatId[] {
    const database = this.chatService.getDatabase()
    return (
      database
        .prepare(
          `
            SELECT DISTINCT chat_id
            FROM chat_turns
            WHERE status = 'queued'
          `,
        )
        .all() as Array<{ chat_id: string }>
    ).map((row) => row.chat_id)
  }

  private hasQueuedTurns(chatId: ChatId): boolean {
    const database = this.chatService.getDatabase()
    const row = database
      .prepare(
        `
          SELECT 1 AS present
          FROM chat_turns
          WHERE chat_id = ? AND status = 'queued'
          LIMIT 1
        `,
      )
      .get(chatId) as { present: number } | undefined

    return typeof row?.present === "number"
  }

  private hasRunningTurn(chatId: ChatId): boolean {
    const database = this.chatService.getDatabase()
    const row = database
      .prepare(
        `
          SELECT 1 AS present
          FROM chat_turns
          WHERE chat_id = ? AND status = 'running'
          LIMIT 1
        `,
      )
      .get(chatId) as { present: number } | undefined

    return typeof row?.present === "number"
  }

  private async updateWorkspaceDescription(chatId: ChatId): Promise<void> {
    const execFileAsync = promisify(execFile)

    const chat = this.chatService.get(chatId)
    const recentMessages = this.chatService.listMessages(chatId)
    const summaryMessages = recentMessages.slice(-10).map((m) => ({
      role: m.role,
      content: m.contentMarkdown ?? "",
    }))
    const userPrompt = buildSummaryPrompt(chat.workspaceDescription, summaryMessages)
    const systemPrompt = getSystemPrompt()
    const { provider, model } = selectSummaryModel(chat.provider)

    let description: string

    if (provider === "claude") {
      const { stdout } = await execFileAsync(
        "claude",
        ["-p", userPrompt, "--system-prompt", systemPrompt, "--model", model, "--output-format", "text"],
        { timeout: 15_000 },
      )
      description = stdout.trim().slice(0, 120)
    } else {
      // Codex: use exec --json mode and extract the last assistant message text
      const { stdout } = await execFileAsync(
        "codex",
        [
          "-a", "never",
          "exec",
          "--json",
          "--ephemeral",
          "--skip-git-repo-check",
          "-m", model,
          userPrompt,
        ],
        { timeout: 15_000 },
      )
      // Parse JSONL output to find the last non-delta text message
      const lines = stdout.split("\n")
      let finalText = ""
      for (const line of lines) {
        try {
          const payload = JSON.parse(line) as Record<string, unknown>
          const payloadType = typeof payload.type === "string" ? payload.type : ""
          // Look for final message text (not delta)
          if (!payloadType.includes("delta")) {
            const content = payload.content
            if (typeof content === "string" && content.length > 0) {
              finalText = content
            } else if (typeof payload.text === "string" && payload.text.length > 0) {
              finalText = payload.text
            }
          }
        } catch {
          // Skip non-JSON lines
        }
      }
      description = finalText.trim().slice(0, 120)
    }

    if (description.length > 0) {
      this.chatService.updateWorkspaceDescription(chatId, description)
    }
  }

  private notifyTurnEvents(events: ChatTurnEventSnapshot[]): void {
    for (const event of events) {
      this.notifyTurnEventListeners(event)
    }
  }

  private appendTurnEventInternal(input: {
    chatId: ChatId
    turnId: ChatTurnId
    eventType: string
    source: string
    actorType: string
    actorId?: string | null
    payload: Record<string, unknown>
    occurredAt?: string
    recordedAt?: string
  }): ChatTurnEventSnapshot {
    const database = this.chatService.getDatabase()
    const turnRow = readChatTurnRow(
      database
        .prepare(
          `
            SELECT
              turn_id,
              chat_id,
              session_id,
              client_turn_id,
              user_message_id,
              assistant_message_id,
              status,
              provider,
              model,
              vendor_session_id,
              started_at,
              updated_at,
              completed_at,
              failure_code,
              failure_message,
              cancel_requested_at
            FROM chat_turns
            WHERE turn_id = ?
          `,
        )
        .get(input.turnId),
    )

    if (!turnRow || turnRow.chat_id !== input.chatId) {
      throw new IpcProtocolError(
        "not_found",
        `Chat turn not found: ${input.turnId} in chat ${input.chatId}`,
      )
    }

    const nextSequenceRow = database
      .prepare(
        `
          SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
          FROM chat_turn_events
          WHERE turn_id = ?
        `,
      )
      .get(input.turnId) as { next_sequence: number } | undefined
    const nextSequence = nextSequenceRow?.next_sequence ?? 1

    const recordedAt = input.recordedAt ?? this.now()
    const occurredAt = input.occurredAt ?? recordedAt
    const eventId = `chat_turn_event_${randomUUID()}`
    database
      .prepare(
        `
          INSERT INTO chat_turn_events (
            event_id,
            chat_id,
            turn_id,
            sequence_number,
            event_type,
            payload_json,
            source,
            actor_type,
            actor_id,
            occurred_at,
            recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        eventId,
        input.chatId,
        input.turnId,
        nextSequence,
        input.eventType,
        JSON.stringify(input.payload),
        input.source,
        input.actorType,
        input.actorId ?? null,
        occurredAt,
        recordedAt,
      )

    return this.getTurnEvent(input.chatId, input.turnId, eventId)
  }

  private getTurnEvent(
    chatId: ChatId,
    turnId: ChatTurnId,
    eventId: string,
  ): ChatTurnEventSnapshot {
    const row = readChatTurnEventRow(
      this.chatService
        .getDatabase()
        .prepare(
          `
            SELECT
              event_id,
              chat_id,
              turn_id,
              sequence_number,
              event_type,
              payload_json,
              source,
              actor_type,
              actor_id,
              occurred_at,
              recorded_at
            FROM chat_turn_events
            WHERE event_id = ? AND chat_id = ? AND turn_id = ?
          `,
        )
        .get(eventId, chatId, turnId),
    )

    if (!row) {
      throw new IpcProtocolError(
        "internal_error",
        `Chat turn event ${eventId} could not be loaded after insert.`,
      )
    }

    return mapChatTurnEventRow(row)
  }

  private notifyTurnEventListeners(event: ChatTurnEventSnapshot): void {
    const listeners = this.turnEventListenersByChatId.get(event.chatId)
    if (!listeners) {
      return
    }

    for (const entry of listeners) {
      if (entry.turnId && entry.turnId !== event.turnId) {
        continue
      }
      entry.listener(event)
    }
  }

  private async runTurnWithRecovery(
    chat: ReturnType<ChatService["get"]>,
    rootPath: string,
    chatSessionId: string,
    prompt: string,
    continuationPrompt: string | null,
    seedMessages: ChatMessageSnapshot[],
    vendorSessionId: string | null,
    signal?: AbortSignal,
    onEvent?: (event: ChatRuntimeEvent) => void,
    attachments?: Array<{ type: "image" | "text"; name: string; media_type: string; data: string }>,
  ) {
    const adapter = this.runtimeRegistry.get(chat.provider)

    try {
      return await adapter.runTurn({
        chatId: chat.id,
        chatSessionId,
        cwd: rootPath,
        prompt,
        config: this.extractConfig(chat),
        continuationPrompt,
        seedMessages,
        vendorSessionId,
        attachments,
        signal,
        onEvent,
      })
    } catch (error) {
      if (!this.isRuntimeError(error) || error.kind !== "resume_failed") {
        throw error
      }

      this.sessionManager.invalidate(chat.id, chatSessionId)

      return adapter.runTurn({
        chatId: chat.id,
        chatSessionId,
        cwd: rootPath,
        prompt,
        config: this.extractConfig(chat),
        continuationPrompt,
        seedMessages,
        vendorSessionId: null,
        attachments,
        signal,
        onEvent,
      })
    }
  }

  private persistCheckpointCandidates(
    chatId: ChatId,
    checkpoints: ChatRuntimeCheckpointCandidate[],
  ): string[] {
    return checkpoints.map((checkpoint) =>
      this.chatService.createActionCheckpoint({
        chatId,
        activeTargetPath: checkpoint.activeTargetPath ?? null,
        branchName: checkpoint.branchName ?? null,
        worktreePath: checkpoint.worktreePath ?? null,
        actionType: checkpoint.actionType,
        affectedPaths: checkpoint.affectedPaths,
        commandMetadataJson: checkpoint.commandMetadata
          ? serializeJson(checkpoint.commandMetadata)
          : null,
        resultSummary: checkpoint.resultSummary ?? null,
        artifactRefsJson: checkpoint.artifactRefs
          ? serializeJson(checkpoint.artifactRefs)
          : null,
      }),
    )
  }

  private extractConfig(
    chat: ReturnType<ChatService["get"]>,
  ): ChatRuntimeConfig {
    return {
      provider: chat.provider,
      model: chat.model,
      thinkingLevel: chat.thinkingLevel,
      permissionLevel: chat.permissionLevel,
    }
  }

  private isRuntimeError(error: unknown): error is ChatRuntimeError {
    return (
      error instanceof Error &&
      "kind" in error &&
      typeof (error as { kind?: unknown }).kind === "string"
    )
  }

  private mapRuntimeError(error: ChatRuntimeError): IpcProtocolError {
    switch (error.kind) {
      case "invalid_config":
        return new IpcProtocolError("invalid_request", error.message, {
          details: error.diagnostics,
        })
      case "resume_failed":
      case "launch_failed":
      case "unexpected_exit":
      case "empty_response":
      case "protocol_error":
        return new IpcProtocolError("runtime_unavailable", error.message, {
          details: error.diagnostics,
        })
      default:
        return new IpcProtocolError("internal_error", error.message, {
          details: error.diagnostics,
        })
    }
  }
}
