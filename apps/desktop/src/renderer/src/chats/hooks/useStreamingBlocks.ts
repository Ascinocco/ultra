// useStreamingBlocks.ts
import { useMemo, useRef } from "react"
import type { ChatTurnEventSnapshot } from "@ultra/shared"
import type { StreamingBlock, ToolEntry } from "../streaming/streaming-types.js"
import { getToolConfig, shouldFilterToolEvent, extractToolId } from "../streaming/tool-map.js"

export interface StreamingBlocksState {
  blocks: StreamingBlock[] | null
  isStreaming: boolean
}

/**
 * Pure function for testing. Derives streaming blocks from turn events.
 */
export function deriveStreamingBlocks(
  events: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,
  messageCountAtTurnStart: number,
): StreamingBlocksState {
  const blocks: StreamingBlock[] = []
  let hasContent = false
  let toolGroupCounter = 0

  for (const event of events) {
    if (event.eventType === "chat.turn_assistant_delta") {
      const text = (event.payload as { text: string }).text
      hasContent = true

      const last = blocks[blocks.length - 1]
      if (last && last.type === "text") {
        last.content += text
      } else {
        blocks.push({ type: "text", content: text })
      }
    } else if (event.eventType === "chat.turn_progress") {
      const payload = event.payload as { stage?: string; label?: string; metadata?: any }
      if (payload.stage !== "tool_activity") continue
      const label = payload.label ?? ""
      if (shouldFilterToolEvent(label)) continue

      // AskUserQuestion: emit as text block instead of tool_group
      if (label === "AskUserQuestion") {
        const questionText = (payload.metadata as any)?.input?.question
          ?? (payload.metadata as any)?.input?.text
          ?? ""
        if (questionText) {
          hasContent = true
          const last = blocks[blocks.length - 1]
          if (last && last.type === "text") {
            last.content += "\n\n" + questionText
          } else {
            blocks.push({ type: "text", content: questionText })
          }
          continue
        }
        // If no question text, fall through to normal tool handling
      }

      hasContent = true
      const metadata = payload.metadata
      const toolId = extractToolId(metadata) ?? `anon_${event.sequenceNumber}`
      const config = getToolConfig(label)
      const detail = config.extractDetail(metadata)

      // Find or create current tool_group
      const last = blocks[blocks.length - 1]
      let group: StreamingBlock & { type: "tool_group" }
      if (last && last.type === "tool_group") {
        group = last
      } else {
        toolGroupCounter++
        group = { type: "tool_group", id: `tg_${toolGroupCounter}`, tools: [], collapsed: false }
        blocks.push(group)
      }

      // Deduplicate by tool ID
      const existing = group.tools.find((t) => t.id === toolId)
      if (existing) {
        existing.detail = detail || existing.detail
        existing.status = "done"
      } else {
        group.tools.push({
          id: toolId,
          toolName: label,
          detail,
          icon: config.icon,
          status: "running",
        })
      }
    }
    // Ignore all other event types
  }

  // Auto-collapse tool groups that are followed by a text block
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i]
    const next = blocks[i + 1]
    if (block.type === "tool_group" && next.type === "text") {
      block.collapsed = true
      for (const tool of block.tools) {
        if (tool.status === "running") {
          tool.status = "done"
        }
      }
    }
  }

  // Determine visibility
  if (inFlightTurn) {
    return { blocks, isStreaming: true }
  }

  // Turn ended — check if the final message has arrived
  if (hasContent && messageCount === messageCountAtTurnStart) {
    // Race condition: turn status updated but message not yet delivered
    return { blocks, isStreaming: false }
  }

  return { blocks: null, isStreaming: false }
}

/**
 * React hook that derives streaming blocks from turn events in the store.
 */
export function useStreamingBlocks(
  activeTurnEvents: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,
): StreamingBlocksState {
  const messageCountAtTurnStartRef = useRef(messageCount)
  const prevInFlightRef = useRef(false)

  // Capture message count when turn transitions from idle to in-flight
  if (inFlightTurn && !prevInFlightRef.current) {
    messageCountAtTurnStartRef.current = messageCount
  }
  prevInFlightRef.current = inFlightTurn

  return useMemo(
    () =>
      deriveStreamingBlocks(
        activeTurnEvents,
        inFlightTurn,
        messageCount,
        messageCountAtTurnStartRef.current,
      ),
    [activeTurnEvents, inFlightTurn, messageCount],
  )
}
