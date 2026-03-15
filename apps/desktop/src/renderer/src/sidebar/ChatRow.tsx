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
}: {
  chat: ChatSummary
  isActive: boolean
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      onContextMenu({
        preventDefault: () => undefined,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom,
      } as React.MouseEvent)
    }
  }

  return (
    <button
      className={`chat-row ${isActive ? "chat-row--active" : ""} ${chat.isPinned ? "chat-row--pinned" : ""}`}
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      aria-current={isActive ? "true" : undefined}
    >
      <span className="chat-row__title">{chat.title}</span>
      <span className="chat-row__time">{formatRelativeTime(chat.updatedAt)}</span>
    </button>
  )
}
