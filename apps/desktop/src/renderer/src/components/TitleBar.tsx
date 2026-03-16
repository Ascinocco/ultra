export function TitleBar({
  terminalOpen,
  onToggleTerminal,
  sidebarCollapsed,
  onToggleSidebar,
  children,
}: {
  terminalOpen?: boolean
  onToggleTerminal?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="title-bar">
      <div className="title-bar__actions">
        <button
          className={`title-bar__sidebar-toggle ${sidebarCollapsed ? "title-bar__sidebar-toggle--collapsed" : ""}`}
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-pressed={!sidebarCollapsed}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <line x1="5.5" y1="2" x2="5.5" y2="14" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className={`title-bar__terminal-toggle ${terminalOpen ? "title-bar__terminal-toggle--active" : ""}`}
          type="button"
          onClick={onToggleTerminal}
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8 14h6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {children}
      </div>
    </div>
  )
}
