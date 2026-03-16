import type {
  ThreadExecutionState,
  ThreadReviewState,
  ThreadSnapshot,
} from "@ultra/shared"

function executionLabel(state: ThreadExecutionState): string {
  const labels: Record<ThreadExecutionState, string> = {
    queued: "Queued",
    starting: "Starting",
    running: "Running",
    blocked: "Blocked",
    awaiting_review: "Review",
    finishing: "Finishing",
    completed: "Done",
    failed: "Failed",
    canceled: "Canceled",
  }
  return labels[state]
}

function reviewLabel(state: ThreadReviewState): string | null {
  const labels: Record<ThreadReviewState, string | null> = {
    not_ready: null,
    ready: "Ready",
    in_review: "In Review",
    changes_requested: "Changes",
    approved: "Approved",
  }
  return labels[state]
}

function needsAttention(thread: ThreadSnapshot): boolean {
  return (
    thread.executionState === "blocked" ||
    thread.executionState === "awaiting_review" ||
    thread.executionState === "failed" ||
    thread.reviewState === "ready"
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

export function ThreadCard({
  thread,
  isSelected,
  onSelect,
}: {
  thread: ThreadSnapshot
  isSelected: boolean
  onSelect: () => void
}) {
  const review = reviewLabel(thread.reviewState)
  const attention = needsAttention(thread)

  return (
    <button
      className={`thread-card ${isSelected ? "thread-card--selected" : ""} ${attention ? "thread-card--attention" : ""}`}
      type="button"
      onClick={onSelect}
      aria-expanded={isSelected}
    >
      <div className="thread-card__header">
        <span className="thread-card__title">{thread.title}</span>
        {attention && (
          <span
            className="thread-card__attention-badge"
            role="img"
            aria-label="Needs attention"
          />
        )}
      </div>
      <div className="thread-card__meta">
        <span className={`state-pill state-pill--${thread.executionState}`}>
          {executionLabel(thread.executionState)}
        </span>
        {review && (
          <span
            className={`state-pill state-pill--review-${thread.reviewState}`}
          >
            {review}
          </span>
        )}
        {thread.branchName && (
          <span className="thread-card__branch">{thread.branchName}</span>
        )}
        <span className="thread-card__time">
          {formatTime(thread.lastActivityAt ?? thread.updatedAt)}
        </span>
      </div>
    </button>
  )
}
