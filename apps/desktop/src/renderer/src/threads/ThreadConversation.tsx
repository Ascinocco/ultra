import type { ThreadMessageSnapshot } from "@ultra/shared"
import { useEffect, useRef, useCallback } from "react"
import type { StreamingBlock } from "../chats/streaming/streaming-types.js"
import { ChatMessage } from "../chat-message/ChatMessage.js"
import { StreamingMessage } from "../chats/streaming/StreamingMessage.js"

type Props = {
  messages: ThreadMessageSnapshot[]
  streamingBlocks: StreamingBlock[] | null
  isStreaming: boolean
}

export function ThreadConversation({
  messages,
  streamingBlocks,
  isStreaming,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  const checkNearBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    // Consider "near bottom" if within 150px of the end
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 150
  }, [])

  // Auto-scroll only if user is near the bottom
  useEffect(() => {
    const el = containerRef.current
    if (!el || !isNearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, streamingBlocks])

  return (
    <div className="thread-conversation">
      <div
        className="thread-conversation__messages"
        ref={containerRef}
        onScroll={checkNearBottom}
      >
        {messages.length === 0 && !streamingBlocks && (
          <p className="thread-conversation__empty">
            Coordinator starting...
          </p>
        )}

        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content.text}
          />
        ))}

        {streamingBlocks && (
          <StreamingMessage
            blocks={streamingBlocks}
            isStreaming={isStreaming}
          />
        )}
      </div>
    </div>
  )
}
