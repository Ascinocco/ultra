import type { ThreadMessageSnapshot } from "@ultra/shared"
import { useRef } from "react"
import type { StreamingBlock } from "../chats/streaming/streaming-types.js"
import { ChatMessage } from "../chat-message/ChatMessage.js"
import { StreamingMessage } from "../chats/streaming/StreamingMessage.js"
import { useAutoScroll } from "../chats/hooks/useAutoScroll.js"

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
  useAutoScroll(containerRef)

  return (
    <div className="thread-conversation">
      <div
        className="thread-conversation__messages"
        ref={containerRef}
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
