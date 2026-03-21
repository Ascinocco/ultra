import { useMemo, useRef } from "react"
import type { ThreadTurnEventSnapshot } from "@ultra/shared"
import type { StreamingBlock } from "../../chats/streaming/streaming-types.js"
import { getToolConfig, shouldFilterToolEvent, extractToolId } from "../../chats/streaming/tool-map.js"

export interface ThreadStreamingState {
  blocks: StreamingBlock[] | null
  isStreaming: boolean
}

export function useThreadStreaming(
  turnEvents: ThreadTurnEventSnapshot[],
  isCoordinatorActive: boolean,
  messageCount: number,
): ThreadStreamingState {
  const messageCountAtStartRef = useRef(messageCount)
  const prevActiveRef = useRef(false)

  if (isCoordinatorActive && !prevActiveRef.current) {
    messageCountAtStartRef.current = messageCount
  }
  prevActiveRef.current = isCoordinatorActive

  return useMemo(() => {
    if (turnEvents.length === 0 && !isCoordinatorActive) {
      return { blocks: null, isStreaming: false }
    }

    const blocks: StreamingBlock[] = []
    let hasContent = false
    let toolGroupCounter = 0

    for (let i = 0; i < turnEvents.length; i++) {
      const event = turnEvents[i]!

      if (event.eventType === "assistant_delta") {
        const text = (event.payload as { text?: string }).text ?? ""
        if (!text) continue
        hasContent = true

        const last = blocks[blocks.length - 1]
        if (last && last.type === "text") {
          blocks[blocks.length - 1] = { type: "text", content: last.content + text }
        } else {
          blocks.push({ type: "text", content: text })
        }
      } else if (event.eventType === "tool_activity") {
        const payload = event.payload as { label?: string; metadata?: Record<string, unknown> }
        const label = payload.label ?? ""
        if (!label || shouldFilterToolEvent(label)) continue

        // AskUserQuestion: render as text block (same as chat system)
        if (label === "AskUserQuestion") {
          const meta = payload.metadata as Record<string, any> | undefined
          const questionText = meta?.input?.question ?? meta?.input?.text ?? ""
          if (questionText) {
            hasContent = true
            const last = blocks[blocks.length - 1]
            if (last && last.type === "text") {
              blocks[blocks.length - 1] = { type: "text", content: last.content + "\n\n" + questionText }
            } else {
              blocks.push({ type: "text", content: questionText })
            }
            continue
          }
        }

        hasContent = true
        const config = getToolConfig(label)
        const detail = config.extractDetail(payload.metadata)
        const toolId = extractToolId(payload.metadata) ?? `tt_${i}`

        const last = blocks[blocks.length - 1]
        let group: StreamingBlock & { type: "tool_group" }
        if (last && last.type === "tool_group") {
          group = last
        } else {
          toolGroupCounter++
          group = {
            type: "tool_group",
            id: `ttg_${toolGroupCounter}`,
            tools: [],
            collapsed: false,
          }
          blocks.push(group)
        }

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
            status: isCoordinatorActive ? "running" : "done",
            ...(label === "Skill" ? { subtype: "skill" } : {}),
          })
        }
      }
    }

    // Auto-collapse completed tool groups (followed by text)
    const collapsed: StreamingBlock[] = blocks.map((block, i) => {
      if (block.type === "tool_group" && blocks[i + 1]?.type === "text") {
        return {
          ...block,
          collapsed: true,
          tools: block.tools.map((t) => t.status === "running" ? { ...t, status: "done" as const } : t),
        }
      }
      return block
    })

    if (isCoordinatorActive) {
      return { blocks: collapsed, isStreaming: true }
    }

    if (hasContent && messageCount === messageCountAtStartRef.current) {
      return { blocks: collapsed, isStreaming: false }
    }

    return { blocks: null, isStreaming: false }
  }, [turnEvents, isCoordinatorActive, messageCount])
}
