import type { ThreadMessageSnapshot, ThreadSnapshot } from "@ultra/shared"
import { useEffect, useState } from "react"

import type { StreamingBlock } from "../chats/streaming/streaming-types.js"
import type { TaskItem } from "./hooks/useThreadTasks.js"
import { ThreadCard } from "./ThreadCard.js"
import { ThreadDetail } from "./ThreadDetail.js"

export function ThreadPane({
  threads,
  selectedThreadId,
  messagesByThreadId,
  streamingBlocksByThreadId,
  isStreamingByThreadId,
  activeThreadTurnId,
  fetchStatus,
  onSelectThread,
  onFetchMessages,
  onSendMessage,
  onCancelCoordinator,
  onApprove,
  onArchive,
  onUnarchive,
  onRetry,
  tasksByThreadId,
}: {
  threads: ThreadSnapshot[]
  selectedThreadId: string | null
  messagesByThreadId: Record<string, ThreadMessageSnapshot[]>
  streamingBlocksByThreadId: Record<string, StreamingBlock[] | null>
  isStreamingByThreadId: Record<string, boolean>
  activeThreadTurnId: string | null
  fetchStatus: "idle" | "loading" | "error"
  onSelectThread: (threadId: string | null) => void
  onFetchMessages: (threadId: string) => void
  onSendMessage: (threadId: string, content: string, files: File[]) => void
  onCancelCoordinator?: (threadId: string) => void
  onApprove?: (threadId: string) => void
  onArchive?: (threadId: string) => void
  onUnarchive?: (threadId: string) => void
  onRetry?: (threadId: string) => void
  tasksByThreadId: Record<string, { tasks: TaskItem[]; percentage: number; allComplete: boolean; hasFailed: boolean }>
}) {
  const [showArchived, setShowArchived] = useState(false)

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

  const visibleThreads = showArchived
    ? threads
    : threads.filter((t) => !t.archived)

  if (threads.length === 0) {
    return (
      <div className="thread-pane thread-pane--empty">
        <p className="thread-pane__status">No threads yet</p>
        <p className="thread-pane__hint">
          Move work to a thread when it's ready for handoff
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
          streamingBlocks={streamingBlocksByThreadId[selectedThread.id] ?? null}
          isStreaming={isStreamingByThreadId[selectedThread.id] ?? false}
          isCoordinatorActive={activeThreadTurnId === selectedThread.id}
          allThreads={threads}
          tasks={tasksByThreadId[selectedThread.id]?.tasks ?? []}
          taskPercentage={tasksByThreadId[selectedThread.id]?.percentage ?? 0}
          tasksAllComplete={tasksByThreadId[selectedThread.id]?.allComplete ?? false}
          tasksHasFailed={tasksByThreadId[selectedThread.id]?.hasFailed ?? false}
          onBack={() => onSelectThread(null)}
          onSendMessage={(content, files) =>
            onSendMessage(selectedThread.id, content, files)
          }
          onSelectThread={onSelectThread}
          onCancelCoordinator={
            onCancelCoordinator
              ? () => onCancelCoordinator(selectedThread.id)
              : undefined
          }
          onApprove={onApprove ? () => onApprove(selectedThread.id) : undefined}
          onArchive={onArchive ? () => onArchive(selectedThread.id) : undefined}
          onUnarchive={onUnarchive ? () => onUnarchive(selectedThread.id) : undefined}
          onRetry={onRetry ? () => onRetry(selectedThread.id) : undefined}
        />
      </div>
    )
  }

  return (
    <div className="thread-pane">
      {threads.some((t) => t.archived) && (
        <button
          className="thread-pane__archive-toggle"
          type="button"
          onClick={() => setShowArchived(!showArchived)}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      )}
      <div className="thread-pane__list">
        {visibleThreads.map((thread) => (
          <div key={thread.id} style={thread.archived ? { opacity: 0.5 } : undefined}>
            <ThreadCard
              thread={thread}
              isSelected={false}
              onSelect={() => onSelectThread(thread.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
