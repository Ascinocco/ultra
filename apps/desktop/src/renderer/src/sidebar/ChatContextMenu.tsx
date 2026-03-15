import type { ChatSummary } from "@ultra/shared"
import { useCallback, useEffect, useRef } from "react"

export type ContextMenuState = {
  chat: ChatSummary
  x: number
  y: number
} | null

export function ChatContextMenu({
  state,
  onClose,
  onRename,
  onTogglePin,
  onArchive,
}: {
  state: ContextMenuState
  onClose: () => void
  onRename: (chat: ChatSummary) => void
  onTogglePin: (chat: ChatSummary) => void
  onArchive: (chat: ChatSummary) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    },
    [onClose],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!state) return
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [state, handleClickOutside, handleKeyDown])

  if (!state) return null

  return (
    <div
      ref={menuRef}
      className="chat-context-menu"
      role="menu"
      style={{ top: state.y, left: state.x }}
    >
      <button
        className="chat-context-menu__item"
        role="menuitem"
        type="button"
        onClick={() => {
          onRename(state.chat)
          onClose()
        }}
      >
        Rename
      </button>
      <button
        className="chat-context-menu__item"
        role="menuitem"
        type="button"
        onClick={() => {
          onTogglePin(state.chat)
          onClose()
        }}
      >
        {state.chat.isPinned ? "Unpin" : "Pin"}
      </button>
      <button
        className="chat-context-menu__item"
        role="menuitem"
        type="button"
        onClick={() => {
          onArchive(state.chat)
          onClose()
        }}
      >
        Archive
      </button>
    </div>
  )
}
