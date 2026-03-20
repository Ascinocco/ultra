import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeSessionManager, type ClaudeSessionManagerConfig } from "./claude-session-manager.js"
import type {
  ChatRuntimeAdapter,
  ChatRuntimeEvent,
  ChatRuntimeTurnRequest,
  ChatRuntimeTurnResult,
} from "./types.js"

/**
 * Maps an SDK message to zero or more ChatRuntimeEvent objects.
 * Only maps events we care about — text deltas, tool activity, final result, errors.
 */
function mapSdkMessage(message: SDKMessage): {
  events: ChatRuntimeEvent[]
  finalText?: string
  vendorSessionId?: string
} {
  const events: ChatRuntimeEvent[] = []
  let finalText: string | undefined
  let vendorSessionId: string | undefined

  // Extract session ID from any message that carries it
  if ("session_id" in message && typeof message.session_id === "string") {
    vendorSessionId = message.session_id
  }

  if (message.type === "content_block_delta") {
    const delta = (message as any).delta
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      events.push({ type: "assistant_delta", text: delta.text })
    } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      events.push({ type: "runtime_notice", message: delta.thinking })
    }
  } else if (message.type === "content_block_start") {
    const block = (message as any).content_block
    if (block?.type === "tool_use" && typeof block.name === "string") {
      events.push({
        type: "tool_activity",
        label: block.name,
        metadata: { id: block.id },
      })
    }
  } else if (message.type === "result") {
    const resultMessage = message as any
    // Extract final text from the result's message content
    if (resultMessage.message?.content && Array.isArray(resultMessage.message.content)) {
      const textParts = resultMessage.message.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
      finalText = textParts.join("")
    }
    if (resultMessage.session_id) {
      vendorSessionId = resultMessage.session_id
    }
    // Check for errors
    if (resultMessage.is_error || resultMessage.subtype === "error") {
      const errorText = resultMessage.error?.message ?? "Unknown SDK error"
      events.push({ type: "runtime_error", message: errorText })
    }
  }

  return { events, finalText, vendorSessionId }
}

export class ClaudeChatRuntimeAdapter implements ChatRuntimeAdapter {
  readonly provider = "claude" as const
  private sessionManager: ClaudeSessionManager

  constructor(config: ClaudeSessionManagerConfig = {}) {
    this.sessionManager = new ClaudeSessionManager(config)
  }

  async runTurn(request: ChatRuntimeTurnRequest): Promise<ChatRuntimeTurnResult> {
    const session = this.sessionManager.getOrCreate(request.chatId, {
      cwd: request.cwd,
      model: request.config.model,
      permissionLevel: request.config.permissionLevel,
      thinkingLevel: request.config.thinkingLevel,
      vendorSessionId: request.vendorSessionId,
    })

    console.log(`[claude-sdk] runTurn called for chat ${request.chatId}, onEvent=${!!request.onEvent}`)

    // Build the user message
    const userMessage = {
      role: "user" as const,
      content: request.prompt,
    }

    // Push user message to the session's prompt stream
    session.promptQueue.push(userMessage as any)

    // Consume SDK messages
    const collectedEvents: ChatRuntimeEvent[] = []
    let finalText = ""
    let vendorSessionId: string | null = session.vendorSessionId
    const deltas: string[] = []

    // Wire abort signal — use a promise we can reject to unblock iterator.next()
    let abortHandler: (() => void) | undefined
    let rejectOnAbort: ((reason: Error) => void) | undefined
    const abortPromise = new Promise<never>((_, reject) => {
      rejectOnAbort = reject
    })

    if (request.signal) {
      abortHandler = () => {
        session.queryRuntime.interrupt().catch(() => {})
        session.stopped = true
        rejectOnAbort?.(new DOMException("The operation was aborted.", "AbortError"))
      }
      if (request.signal.aborted) {
        abortHandler()
      } else {
        request.signal.addEventListener("abort", abortHandler, { once: true })
      }
    }

    // IMPORTANT: Do NOT use `for await` — it calls iterator.return() on break,
    // which terminates the SDK stream permanently. Use manual .next() calls instead
    // so the session can be reused across turns.
    const iterator = session.queryRuntime[Symbol.asyncIterator]()

    try {
      while (!session.stopped) {
        // Race iterator.next() against abort so we don't block forever
        const iterResult = request.signal
          ? await Promise.race([iterator.next(), abortPromise])
          : await iterator.next()
        const { done, value: message } = iterResult
        if (done || !message) break

        const mapped = mapSdkMessage(message)

        for (const event of mapped.events) {
          console.log(`[claude-sdk] event: ${event.type}`, "text" in event ? (event as any).text?.slice(0, 30) : "")
          collectedEvents.push(event)
          request.onEvent?.(event)

          if (event.type === "assistant_delta") {
            deltas.push(event.text)
          }
        }

        if (mapped.finalText) {
          finalText = mapped.finalText
        }
        if (mapped.vendorSessionId) {
          vendorSessionId = mapped.vendorSessionId
          session.vendorSessionId = mapped.vendorSessionId
        }

        // Result message means this turn is done
        if (message.type === "result") {
          break
        }
      }
    } catch (error) {
      // AbortError is expected when the signal fires — not a real error
      const isAbort = error instanceof DOMException && error.name === "AbortError"
      if (!isAbort) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorEvent: ChatRuntimeEvent = { type: "runtime_error", message: errorMessage }
        collectedEvents.push(errorEvent)
        request.onEvent?.(errorEvent)

        // Destroy session on error — will be recreated on next turn
        this.sessionManager.destroy(request.chatId)
      }
    } finally {
      if (request.signal && abortHandler) {
        request.signal.removeEventListener("abort", abortHandler)
      }
    }

    // Fall back to joining deltas if no explicit finalText
    if (!finalText && deltas.length > 0) {
      finalText = deltas.join("")
    }

    // Add the assistant_final event
    if (finalText) {
      const finalEvent: ChatRuntimeEvent = { type: "assistant_final", text: finalText }
      collectedEvents.push(finalEvent)
      request.onEvent?.(finalEvent)
    }

    return {
      events: collectedEvents,
      finalText,
      vendorSessionId,
      resumed: request.vendorSessionId !== null,
    }
  }

  /**
   * Destroy all sessions (called on backend shutdown).
   */
  shutdown(): void {
    this.sessionManager.destroyAll()
  }
}
