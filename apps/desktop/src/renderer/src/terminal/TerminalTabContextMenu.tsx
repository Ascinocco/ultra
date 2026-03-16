import { useEffect, useRef } from "react"

export function TerminalTabContextMenu({
  x,
  y,
  pinned,
  onRename,
  onTogglePin,
  onClose,
  onDismiss,
}: {
  x: number
  y: number
  pinned: boolean
  onRename: () => void
  onTogglePin: () => void
  onClose: () => void
  onDismiss: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onDismiss()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onDismiss])

  return (
    <div
      ref={menuRef}
      className="terminal-tab-context-menu"
      style={{ left: x, top: y }}
      role="menu"
    >
      <button
        className="terminal-tab-context-menu__item"
        type="button"
        role="menuitem"
        onClick={() => {
          onRename()
          onDismiss()
        }}
      >
        Rename
      </button>
      <button
        className="terminal-tab-context-menu__item"
        type="button"
        role="menuitem"
        onClick={() => {
          onTogglePin()
          onDismiss()
        }}
      >
        {pinned ? "Unpin" : "Pin"}
      </button>
      <div className="terminal-tab-context-menu__separator" />
      <button
        className="terminal-tab-context-menu__item terminal-tab-context-menu__item--danger"
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          onDismiss()
        }}
      >
        Close
      </button>
    </div>
  )
}
