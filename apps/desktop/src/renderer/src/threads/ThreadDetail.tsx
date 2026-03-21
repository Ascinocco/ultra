import type {
  ThreadMessageSnapshot,
  ThreadSnapshot,
} from "@ultra/shared"

import { ThreadConversation } from "./ThreadConversation.js"
import { ThreadInputDock } from "./ThreadInputDock.js"
import type { StreamingBlock } from "../chats/streaming/streaming-types.js"

export function ThreadDetail({
  thread,
  messages,
  streamingBlocks,
  isStreaming,
  isCoordinatorActive,
  onBack,
  onSendMessage,
}: {
  thread: ThreadSnapshot
  messages: ThreadMessageSnapshot[]
  streamingBlocks: StreamingBlock[] | null
  isStreaming: boolean
  isCoordinatorActive: boolean
  onBack: () => void
  onSendMessage: (content: string, files: File[]) => void
}) {
  const isRunning = thread.executionState === "running" && isCoordinatorActive
  const isBlocked = thread.executionState === "blocked"
  const canSend = !isRunning
  const disabledReason = isRunning ? "Coordinator is running..." : undefined

  return (
    <div className="thread-detail">
      <div className="thread-detail__header">
        <button
          className="thread-detail__back"
          type="button"
          onClick={onBack}
          aria-label="Back to thread list"
        >
          &larr;
        </button>
        <h3 className="thread-detail__title">{thread.title}</h3>
        <div className="thread-detail__pills">
          <span className={`state-pill state-pill--${thread.executionState}`}>
            {thread.executionState.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <ThreadConversation
        messages={messages}
        streamingBlocks={streamingBlocks}
        isStreaming={isStreaming}
      />

      <ThreadInputDock
        disabled={!canSend}
        {...(disabledReason != null ? { disabledReason } : {})}
        showWaitingIndicator={isBlocked}
        onSend={onSendMessage}
        model="claude-opus-4-6"
      />
    </div>
  )
}
