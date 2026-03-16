export function TitleBar({
  terminalOpen,
  onToggleTerminal,
  children,
}: {
  terminalOpen?: boolean
  onToggleTerminal?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="title-bar">
      <div className="title-bar__actions">
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
