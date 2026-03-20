import type { ChatSummary } from "@ultra/shared"

function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now()
  const then = new Date(isoTimestamp).getTime()
  const diffMs = now - then
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) return "now"
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

export function ChatRow({
  chat,
  isActive,
  onSelect,
  onContextMenu,
  isEditing,
  renameDraft,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
}: {
  chat: ChatSummary
  isActive: boolean
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
  isEditing?: boolean
  renameDraft?: string
  onRenameDraftChange?: (value: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
}) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      onContextMenu({
        preventDefault: () => undefined,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom,
      } as React.MouseEvent)
    }
  }

  if (isEditing) {
    return (
      <div
        className={`chat-row chat-row--editing ${isActive ? "chat-row--active" : ""} ${chat.isPinned ? "chat-row--pinned" : ""}`}
      >
        <input
          className="chat-row__rename-input"
          type="text"
          value={renameDraft ?? chat.title}
          onChange={(event) => onRenameDraftChange?.(event.target.value)}
          onBlur={() => onRenameCommit?.()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              onRenameCancel?.()
            }
          }}
          aria-label={`Rename ${chat.title}`}
          autoFocus
        />
        <span className="chat-row__time">
          {formatRelativeTime(chat.updatedAt)}
        </span>
      </div>
    )
  }

  const statusConfig = chat.turnStatus
    ? {
        running: { color: "#a6e3a1", label: "Running" },
        waiting_for_input: { color: "#89b4fa", label: "Waiting for input" },
        error: { color: "#f38ba8", label: "Error" },
      }[chat.turnStatus]
    : null

  return (
    <button
      className={`chat-row ${isActive ? "chat-row--active" : ""} ${chat.isPinned ? "chat-row--pinned" : ""}`}
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="chat-row__header">
        <span className="chat-row__title">{chat.title}</span>
        <span className="chat-row__time">
          {formatRelativeTime(chat.updatedAt)}
        </span>
      </div>
      {chat.workspaceDescription && (
        <span className="chat-row__description">
          {chat.workspaceDescription}
        </span>
      )}
      {statusConfig && (
        <span
          className="chat-row__status"
          style={{ color: statusConfig.color }}
        >
          <span
            className="chat-row__status-dot"
            style={{ backgroundColor: statusConfig.color }}
          />
          {statusConfig.label}
        </span>
      )}
    </button>
  )
}
