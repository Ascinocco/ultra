import {
  query,
  type Query,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk"
import type {
  ChatRuntimeAdapter,
  ChatRuntimeEvent,
  ChatRuntimeTurnRequest,
  ChatRuntimeTurnResult,
} from "./types.js"

export type ClaudeSdkAdapterConfig = {
  pathToClaudeCodeExecutable?: string
  defaultEnv?: NodeJS.ProcessEnv
}

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

  if (msg.session_id && typeof msg.session_id === "string") {
    vendorSessionId = msg.session_id
  }

  // Handle stream_event wrapper — unwrap and process the inner event
  if (msg.type === "stream_event" && msg.event) {
    const inner = msg.event as any
    // Recurse into the inner event
    const innerResult = mapSdkMessage(inner as SDKMessage)
    return {
      events: [...events, ...innerResult.events],
      finalText: innerResult.finalText ?? finalText,
      vendorSessionId: innerResult.vendorSessionId ?? vendorSessionId,
    }
  }

  switch (msg.type) {
    case "assistant": {
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
  private config: ClaudeSdkAdapterConfig

  constructor(config: ClaudeSdkAdapterConfig = {}) {
    this.config = config
  }

  async runTurn(request: ChatRuntimeTurnRequest): Promise<ChatRuntimeTurnResult> {

    const options: ClaudeQueryOptions = {
      cwd: request.cwd,
      model: request.config.model,
      pathToClaudeCodeExecutable: this.config.pathToClaudeCodeExecutable ?? "claude",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      env: this.config.defaultEnv ?? process.env,
      ...(request.vendorSessionId
        ? { resume: request.vendorSessionId }
        : {}),
    }

    // Use query() with string prompt — single-turn, yields streaming events including content_block_delta
    const queryRuntime = query({ prompt: request.prompt, options })

    const collectedEvents: ChatRuntimeEvent[] = []
    let finalText = ""
    let vendorSessionId: string | null = request.vendorSessionId ?? null
    const deltas: string[] = []

    try {
      for await (const message of queryRuntime) {

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
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorEvent: ChatRuntimeEvent = { type: "runtime_error", message: errorMessage }
      collectedEvents.push(errorEvent)
      request.onEvent?.(errorEvent)
    }

    if (!finalText && deltas.length > 0) {
      finalText = deltas.join("")
    }

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
    // No persistent sessions to clean up with per-turn query() approach
  }
}
