import { useState, type ReactElement } from "react"
import "./promote-drawer.css"

type Props = {
  messageCount: number
  disabled: boolean
  onPromote: () => void
}

function ChevronUp() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 6L8 2L13 6" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 2L8 6L13 2" />
    </svg>
  )
}

export function PromoteDrawer({ messageCount, disabled, onPromote }: Props): ReactElement | null {
  const [expanded, setExpanded] = useState(false)

  if (messageCount < 3) return null

  if (!expanded) {
    return (
      <div className="promote-drawer__lip" onClick={() => setExpanded(true)}>
        <span className="promote-drawer__chevron"><ChevronUp /></span>
      </div>
    )
  }

  return (
    <div className="promote-drawer__expanded">
      <span className="promote-drawer__chevron" onClick={() => setExpanded(false)}>
        <ChevronDown />
      </span>
      <div className="promote-drawer__info">
        <div>
          <span className="promote-drawer__label">Promote to Thread</span>
          <span className="promote-drawer__count">{messageCount} messages</span>
        </div>
        <button className="promote-drawer__button" disabled={disabled}
          onClick={onPromote} type="button">
          ⬆ Promote
        </button>
      </div>
    </div>
  )
}
