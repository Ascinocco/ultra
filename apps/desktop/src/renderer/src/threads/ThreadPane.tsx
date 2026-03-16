import type { ThreadMessageSnapshot, ThreadSnapshot } from "@ultra/shared"
import { useEffect } from "react"

import { ThreadCard } from "./ThreadCard.js"
import { ThreadDetail } from "./ThreadDetail.js"

export function ThreadPane({
  threads,
  selectedThreadId,
  messagesByThreadId,
  fetchStatus,
  onSelectThread,
  onFetchMessages,
  onSendMessage,
}: {
  threads: ThreadSnapshot[]
  selectedThreadId: string | null
  messagesByThreadId: Record<string, ThreadMessageSnapshot[]>
  fetchStatus: "idle" | "loading" | "error"
  onSelectThread: (threadId: string | null) => void
  onFetchMessages: (threadId: string) => void
  onSendMessage: (threadId: string, content: string) => void
}) {
  const selectedThread = selectedThreadId
    ? (threads.find((t) => t.id === selectedThreadId) ?? null)
    : null

  // Fetch messages when a thread is selected
  // biome-ignore lint/correctness/useExhaustiveDependencies: onFetchMessages is stable
  useEffect(() => {
    if (selectedThreadId) {
      onFetchMessages(selectedThreadId)
    }
  }, [selectedThreadId])

  if (fetchStatus === "loading" && threads.length === 0) {
    return (
      <div className="thread-pane thread-pane--loading">
        <p className="thread-pane__status">Loading threads...</p>
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="thread-pane thread-pane--empty">
        <p className="thread-pane__status">No threads yet</p>
        <p className="thread-pane__hint">
          Threads are created when you approve a plan and start work
        </p>
      </div>
    )
  }

  if (selectedThread) {
    return (
      <div className="thread-pane">
        <ThreadDetail
          thread={selectedThread}
          messages={messagesByThreadId[selectedThread.id] ?? []}
          events={[]}
          eventsLoading={false}
          onBack={() => onSelectThread(null)}
          onSendMessage={(content) => onSendMessage(selectedThread.id, content)}
        />
      </div>
    )
  }

  return (
    <div className="thread-pane">
      <div className="thread-pane__list">
        {threads.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            isSelected={false}
            onSelect={() => onSelectThread(thread.id)}
          />
        ))}
      </div>
    </div>
  )
}
