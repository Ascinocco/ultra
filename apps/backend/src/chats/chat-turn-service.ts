import { randomUUID } from "node:crypto"
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
  ChatRuntimeError,
} from "./runtime/types.js"

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

  constructor(
    private readonly chatService: ChatService,
    private readonly runtimeRegistry: ChatRuntimeRegistry,
    private readonly sessionManager: ChatRuntimeSessionManager,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  startTurn(input: {
    chatId: ChatId
    prompt: string
    clientTurnId?: string
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
      const userMessage = this.chatService.appendMessage({
        chatId: input.chatId,
        role: "user",
        messageType: "user_text",
        contentMarkdown: normalizedPrompt,
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

    this.notifyTurnEventListeners(queuedEvent)

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

    const database = this.chatService.getDatabase()
    const timestamp = this.now()
    let canceledEvent: ChatTurnEventSnapshot

    database.exec("BEGIN")
    try {
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

      canceledEvent = this.appendTurnEventInternal({
        chatId,
        turnId,
        eventType: "chat.turn_canceled",
        source: "api",
        actorType: "user",
        actorId: null,
        payload: { reason: "cancel_requested" },
        occurredAt: timestamp,
        recordedAt: timestamp,
      })
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }

    this.notifyTurnEventListeners(canceledEvent)
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

    const nextSequence = database
      .prepare<[string], { next_sequence: number }>(
        `
          SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
          FROM chat_turn_events
          WHERE turn_id = ?
        `,
      )
      .get(input.turnId).next_sequence

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
