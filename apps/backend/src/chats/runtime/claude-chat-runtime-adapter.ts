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
 */
function mapSdkMessage(message: SDKMessage): {
  events: ChatRuntimeEvent[]
  finalText?: string
  vendorSessionId?: string
} {
  const events: ChatRuntimeEvent[] = []
  let finalText: string | undefined
  let vendorSessionId: string | undefined

  const msg = message as any

  // Extract session ID
  if (msg.session_id && typeof msg.session_id === "string") {
    vendorSessionId = msg.session_id
  }

  switch (msg.type) {
    case "assistant": {
      // Full assistant message — extract text from content blocks
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            events.push({ type: "assistant_delta", text: block.text })
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool_activity",
              label: block.name ?? "tool",
              metadata: { id: block.id, input: block.input },
            })
          }
        }
      }
      break
    }
    case "content_block_delta": {
      const delta = msg.delta
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        events.push({ type: "assistant_delta", text: delta.text })
      } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        events.push({ type: "runtime_notice", message: delta.thinking })
      }
      break
    }
    case "content_block_start": {
      const block = msg.content_block
      if (block?.type === "tool_use" && typeof block.name === "string") {
        events.push({
          type: "tool_activity",
          label: block.name,
          metadata: { id: block.id },
        })
      }
      break
    }
    case "result": {
      // Extract final text
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        const textParts = msg.message.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
        finalText = textParts.join("")
      }
      if (msg.session_id) {
        vendorSessionId = msg.session_id
      }
      if (msg.is_error || msg.subtype === "error") {
        const errorText = msg.error?.message ?? msg.result ?? "Unknown SDK error"
        events.push({ type: "runtime_error", message: String(errorText) })
      }
      break
    }
    case "system": {
      if (msg.subtype === "init" && msg.session_id) {
        vendorSessionId = msg.session_id
      }
      break
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

    console.log(`[claude-sdk] runTurn: sending message to session`)

    // Send the user message
    await session.session.send(request.prompt)

    console.log(`[claude-sdk] runTurn: message sent, streaming responses...`)

    // Consume SDK messages from stream()
    const collectedEvents: ChatRuntimeEvent[] = []
    let finalText = ""
    let vendorSessionId: string | null = session.vendorSessionId
    const deltas: string[] = []

    // Wire abort signal
    let abortHandler: (() => void) | undefined
    if (request.signal) {
      abortHandler = () => {
        session.stopped = true
      }
      if (request.signal.aborted) {
        abortHandler()
      } else {
        request.signal.addEventListener("abort", abortHandler, { once: true })
      }
    }

    try {
      for await (const message of session.session.stream()) {
        if (session.stopped) break

        console.log(`[claude-sdk] event: type=${(message as any).type}`)

        const mapped = mapSdkMessage(message)

        for (const event of mapped.events) {
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
        if ((message as any).type === "result") {
          break
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Abort is expected control flow, not an error
        console.log("[claude-sdk] turn aborted")
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error("[claude-sdk] stream error:", errorMessage)
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

  shutdown(): void {
    this.sessionManager.destroyAll()
  }
}
