export function TerminalDrawer({
  height,
  onResize,
  onClose,
}: {
  height: number
  onResize: (height: number) => void
  onClose: () => void
}) {
  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = startY - moveEvent.clientY
      const newHeight = Math.max(100, startHeight + delta)
      onResize(newHeight)
    }

    function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
    }

    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
  }

  return (
    <div
      className="terminal-drawer"
      style={{ height: `${height}px` }}
    >
      <div
        className="terminal-drawer__drag-handle"
        onPointerDown={handlePointerDown}
      />
      <div className="terminal-drawer__header">
        <span className="terminal-drawer__title">Terminal</span>
        <button
          className="terminal-drawer__close"
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
        >
          ×
        </button>
      </div>
      <div className="terminal-drawer__content">
        <p className="terminal-drawer__placeholder">
          Terminal sessions will appear here
        </p>
      </div>
    </div>
  )
}
