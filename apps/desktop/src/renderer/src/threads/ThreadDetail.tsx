import type {
  ThreadMessageSnapshot,
  ThreadSnapshot,
} from "@ultra/shared"
import { useState } from "react"

import { ThreadConversation } from "./ThreadConversation.js"
import { ThreadInputDock } from "./ThreadInputDock.js"
import type { StreamingBlock } from "../chats/streaming/streaming-types.js"

function ThreadSwitcher({
  threads,
  currentThreadId,
  onSelect,
}: {
  threads: ThreadSnapshot[]
  currentThreadId: string
  onSelect: (threadId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const otherThreads = threads.filter((t) => t.id !== currentThreadId)

  if (otherThreads.length === 0) return null

  return (
    <div className="thread-switcher">
      <button
        className="thread-switcher__toggle"
        type="button"
        onClick={() => setOpen(!open)}
      >
        <span className={`thread-switcher__arrow ${open ? "thread-switcher__arrow--open" : ""}`}>
          ▶
        </span>
        {otherThreads.length} other thread{otherThreads.length !== 1 ? "s" : ""}
      </button>
      {open && (
        <div className="thread-switcher__list">
          {otherThreads.map((t) => (
            <button
              key={t.id}
              className="thread-switcher__item"
              type="button"
              onClick={() => onSelect(t.id)}
            >
              <span className="thread-switcher__item-title">{t.title}</span>
              <span className={`state-pill state-pill--${t.executionState}`}>
                {t.executionState.replace(/_/g, " ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ThreadDetail({
  thread,
  messages,
  streamingBlocks,
  isStreaming,
  isCoordinatorActive,
  allThreads,
  onBack,
  onSendMessage,
  onSelectThread,
}: {
  thread: ThreadSnapshot
  messages: ThreadMessageSnapshot[]
  streamingBlocks: StreamingBlock[] | null
  isStreaming: boolean
  isCoordinatorActive: boolean
  allThreads: ThreadSnapshot[]
  onBack: () => void
  onSendMessage: (content: string, files: File[]) => void
  onSelectThread: (threadId: string) => void
}) {
  const isRunning = thread.executionState === "running" && isCoordinatorActive
  const isBlocked = thread.executionState === "blocked"
  const canSend = !isRunning
  const disabledReason = isRunning ? "Coordinator is running..." : undefined

  return (
    <div className="thread-detail">
      <ThreadSwitcher
        threads={allThreads}
        currentThreadId={thread.id}
        onSelect={onSelectThread}
      />

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
        disabledReason={disabledReason}
        showWaitingIndicator={isBlocked}
        onSend={onSendMessage}
        model="claude-opus-4-6"
      />
    </div>
  )
}
