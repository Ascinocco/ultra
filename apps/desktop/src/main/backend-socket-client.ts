import { createConnection } from "node:net"

import type {
  ChatMessageSnapshot,
  ChatTurnSnapshot,
  CommandMethodName,
  IpcErrorCode,
  IpcResponseEnvelope,
  QueryMethodName,
  SubscriptionEventEnvelope,
  SubscriptionMethodName,
} from "@ultra/shared"
import {
  chatsSendMessageInputSchema,
  IPC_PROTOCOL_VERSION,
  parseChatsGetMessagesResult,
  parseChatsGetTurnEventsResult,
  parseChatsStartTurnResult,
  parseChatTurnSnapshot,
  parseIpcResponseEnvelope,
  parseSubscriptionEventEnvelope,
} from "@ultra/shared"

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

const CHAT_SEND_MESSAGE_COMPATIBILITY_TIMEOUT_MS = 300_000
const CHAT_SEND_MESSAGE_COMPATIBILITY_POLL_INTERVAL_MS = 200

export class BackendSocketClient {
  constructor(
    private readonly socketPath: string,
    private readonly logger: Logger = console,
    private readonly timeoutMs = 1_500,
  ) {}

  async query(
    name: QueryMethodName,
    payload: unknown = {},
  ): Promise<IpcResponseEnvelope> {
    return this.sendRequest("query", name, payload, this.timeoutMs)
  }

  async command(
    name: CommandMethodName,
    payload: unknown = {},
  ): Promise<IpcResponseEnvelope> {
    if (name === "chats.send_message") {
      return this.sendMessageWithTurnCompatibility(payload)
    }

    return this.sendRequest("command", name, payload, this.timeoutMs)
  }

  async subscribe(
    name: SubscriptionMethodName,
    payload: unknown = {},
    onEvent: (event: SubscriptionEventEnvelope) => void,
  ): Promise<{ subscriptionId: string; unsubscribe: () => void }> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath)
      let buffer = ""
      let settled = false
      let subscriptionId: string | null = null

      const timeout = setTimeout(() => {
        if (settled) {
          return
        }

        settled = true
        socket.destroy()
        reject(new Error(`Backend subscription timed out: ${name}`))
      }, this.timeoutMs)

      const finishInitial = (callback: () => void) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        callback()
      }

      socket.setEncoding("utf8")
      socket.once("error", (error) => {
        if (!settled) {
          finishInitial(() => {
            reject(error)
          })
          return
        }

        this.logger.error(
          `[desktop] backend subscription ${name} failed: ${error.message}`,
        )
      })
      socket.on("data", (chunk) => {
        buffer += chunk

        while (buffer.includes("\n")) {
          const newlineIndex = buffer.indexOf("\n")
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)

          if (!line) {
            continue
          }

          try {
            if (!subscriptionId) {
              const response = parseIpcResponseEnvelope(JSON.parse(line))

              if (!response.ok) {
                finishInitial(() => {
                  reject(new Error(response.error.message))
                })
                return
              }

              const nextSubscriptionId =
                typeof response.result === "object" &&
                response.result !== null &&
                "subscription_id" in response.result &&
                typeof response.result.subscription_id === "string"
                  ? response.result.subscription_id
                  : null

              if (!nextSubscriptionId) {
                finishInitial(() => {
                  reject(
                    new Error(
                      `Backend subscription missing subscription_id: ${name}`,
                    ),
                  )
                })
                return
              }

              subscriptionId = nextSubscriptionId
              this.logger.info(
                `[desktop] subscribed to backend ${name} as ${subscriptionId}`,
              )
              finishInitial(() => {
                resolve({
                  subscriptionId: nextSubscriptionId,
                  unsubscribe: () => {
                    socket.end()
                  },
                })
              })
              continue
            }

            const event = parseSubscriptionEventEnvelope(JSON.parse(line))

            if (event.subscription_id === subscriptionId) {
              onEvent(event)
            }
          } catch (error) {
            if (!settled) {
              finishInitial(() => {
                reject(error)
              })
              return
            }

            this.logger.error(
              `[desktop] failed to parse backend subscription event for ${name}`,
            )
          }
        }
      })
      socket.once("connect", () => {
        this.logger.info(
          `[desktop] connected to backend socket ${this.socketPath}`,
        )
        socket.write(
          `${JSON.stringify({
            protocol_version: IPC_PROTOCOL_VERSION,
            request_id: requestId,
            type: "subscribe",
            name,
            payload,
          })}\n`,
        )
      })
    })
  }

  private async sendRequest(
    type: "query" | "command",
    name: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<IpcResponseEnvelope> {
    const requestId = this.createRequestId()

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath)
      let buffer = ""
      let settled = false

      const timeout = setTimeout(() => {
        if (settled) {
          return
        }

        settled = true
        socket.destroy()
        reject(new Error(`Backend request timed out: ${name}`))
      }, timeoutMs)

      const finish = (callback: () => void) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        callback()
      }

      socket.setEncoding("utf8")
      socket.once("error", (error) => {
        finish(() => {
          reject(error)
        })
      })
      socket.on("data", (chunk) => {
        buffer += chunk

        if (!buffer.includes("\n")) {
          return
        }

        const line = buffer.slice(0, buffer.indexOf("\n")).trim()

        finish(() => {
          try {
            const response = parseIpcResponseEnvelope(JSON.parse(line))

            this.logger.info(
              `[desktop] received response ${response.request_id}`,
            )
            socket.end()
            resolve(response)
          } catch (error) {
            reject(error)
          }
        })
      })
      socket.once("connect", () => {
        this.logger.info(
          `[desktop] connected to backend socket ${this.socketPath}`,
        )
        socket.write(
          `${JSON.stringify({
            protocol_version: IPC_PROTOCOL_VERSION,
            request_id: requestId,
            type,
            name,
            payload,
          })}\n`,
        )
      })
    })
  }

  private async sendMessageWithTurnCompatibility(
    payload: unknown,
  ): Promise<IpcResponseEnvelope> {
    const requestId = this.createRequestId()
    const parsedPayload = chatsSendMessageInputSchema.safeParse(payload)

    if (!parsedPayload.success) {
      const issue = parsedPayload.error.issues[0]?.message ?? "Invalid payload."
      return this.createErrorResponse(
        requestId,
        "invalid_request",
        `Invalid chats.send_message payload: ${issue}`,
      )
    }

    const startTurnResponse = await this.sendRequest(
      "command",
      "chats.start_turn",
      {
        chat_id: parsedPayload.data.chat_id,
        prompt: parsedPayload.data.prompt,
        client_turn_id: `desktop_compat_${this.createRequestId()}`,
      },
      this.timeoutMs,
    )

    if (!startTurnResponse.ok) {
      return startTurnResponse
    }

    let turn = this.parseTurnFromStartResult(
      startTurnResponse.request_id,
      startTurnResponse.result,
    )
    if (!turn) {
      return this.createErrorResponse(
        startTurnResponse.request_id,
        "internal_error",
        "Invalid chats.start_turn response while handling chats.send_message.",
      )
    }

    const deadline = Date.now() + CHAT_SEND_MESSAGE_COMPATIBILITY_TIMEOUT_MS

    while (turn.status === "queued" || turn.status === "running") {
      const remainingMs = deadline - Date.now()

      if (remainingMs <= 0) {
        return this.createErrorResponse(
          startTurnResponse.request_id,
          "timeout",
          "Backend request timed out: chats.send_message",
        )
      }

      await this.delay(
        Math.min(CHAT_SEND_MESSAGE_COMPATIBILITY_POLL_INTERVAL_MS, remainingMs),
      )

      const getTurnResponse = await this.sendRequest(
        "query",
        "chats.get_turn",
        {
          chat_id: parsedPayload.data.chat_id,
          turn_id: turn.turnId,
        },
        this.timeoutMs,
      )

      if (!getTurnResponse.ok) {
        return getTurnResponse
      }

      try {
        turn = parseChatTurnSnapshot(getTurnResponse.result)
      } catch {
        return this.createErrorResponse(
          startTurnResponse.request_id,
          "internal_error",
          "Invalid chats.get_turn response while handling chats.send_message.",
        )
      }
    }

    if (turn.status === "failed") {
      return this.createErrorResponse(
        startTurnResponse.request_id,
        this.mapTurnFailureCode(turn.failureCode),
        turn.failureMessage ?? "Chat turn failed.",
      )
    }

    if (turn.status === "canceled") {
      return this.createErrorResponse(
        startTurnResponse.request_id,
        "invalid_state_transition",
        "Chat turn was canceled before completion.",
      )
    }

    const getMessagesResponse = await this.sendRequest(
      "query",
      "chats.get_messages",
      {
        chat_id: parsedPayload.data.chat_id,
      },
      this.timeoutMs,
    )

    if (!getMessagesResponse.ok) {
      return getMessagesResponse
    }

    let messages: ChatMessageSnapshot[]
    try {
      messages = parseChatsGetMessagesResult(
        getMessagesResponse.result,
      ).messages
    } catch {
      return this.createErrorResponse(
        startTurnResponse.request_id,
        "internal_error",
        "Invalid chats.get_messages response while handling chats.send_message.",
      )
    }

    const userMessage = messages.find(
      (message) => message.id === turn.userMessageId,
    )
    const assistantMessage = turn.assistantMessageId
      ? messages.find((message) => message.id === turn.assistantMessageId)
      : null

    if (!userMessage || !assistantMessage) {
      return this.createErrorResponse(
        startTurnResponse.request_id,
        "internal_error",
        "Missing chat messages while handling chats.send_message compatibility.",
      )
    }

    const turnEventsResponse = await this.sendRequest(
      "query",
      "chats.get_turn_events",
      {
        chat_id: parsedPayload.data.chat_id,
        turn_id: turn.turnId,
      },
      this.timeoutMs,
    )

    let checkpointIds: string[] = []
    if (turnEventsResponse.ok) {
      try {
        const events = parseChatsGetTurnEventsResult(
          turnEventsResponse.result,
        ).events
        checkpointIds = this.extractCheckpointIds(events)
      } catch {
        return this.createErrorResponse(
          startTurnResponse.request_id,
          "internal_error",
          "Invalid chats.get_turn_events response while handling chats.send_message.",
        )
      }
    }

    return this.createSuccessResponse(startTurnResponse.request_id, {
      userMessage,
      assistantMessage,
      checkpointIds,
    })
  }

  private parseTurnFromStartResult(
    requestId: string,
    result: unknown,
  ): ChatTurnSnapshot | null {
    try {
      return parseChatsStartTurnResult(result).turn
    } catch (error) {
      this.logger.error(
        `[desktop] chats.send_message compatibility parse failed for ${requestId}: ${String(error)}`,
      )
      return null
    }
  }

  private extractCheckpointIds(
    events: Array<{ eventType: string; payload: Record<string, unknown> }>,
  ): string[] {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.eventType !== "chat.turn_completed") {
        continue
      }

      const candidate = event.payload.checkpoint_ids
      if (!Array.isArray(candidate)) {
        return []
      }

      return candidate.filter(
        (value): value is string => typeof value === "string",
      )
    }

    return []
  }

  private mapTurnFailureCode(failureCode: string | null): IpcErrorCode {
    if (!failureCode) {
      return "internal_error"
    }

    if (failureCode === "invalid_config") {
      return "invalid_request"
    }

    if (
      failureCode === "resume_failed" ||
      failureCode === "launch_failed" ||
      failureCode === "unexpected_exit" ||
      failureCode === "empty_response" ||
      failureCode === "protocol_error" ||
      failureCode === "backend_restart"
    ) {
      return "runtime_unavailable"
    }

    return "internal_error"
  }

  private createSuccessResponse(
    requestId: string,
    result: unknown,
  ): IpcResponseEnvelope {
    return {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: requestId,
      type: "response",
      ok: true,
      result,
    }
  }

  private createErrorResponse(
    requestId: string,
    code: IpcErrorCode,
    message: string,
  ): IpcResponseEnvelope {
    return {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: requestId,
      type: "response",
      ok: false,
      error: {
        code,
        message,
      },
    }
  }

  private createRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return
    }

    await new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }
}
