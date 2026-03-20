import { type ReactElement, useState } from "react"
import type { ToolEntry } from "./streaming-types.js"
import { ToolActivityEntry } from "./ToolActivityEntry.js"

type Props = {
  tools: ToolEntry[]
  collapsed: boolean
}

export function ToolActivityGroup({ tools, collapsed: initialCollapsed }: Props): ReactElement {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  // Sync with prop when it changes (auto-collapse from hook)
  // useEffect would work but for simplicity, derive:
  // The prop controls the initial state; user can override via click

  const uniqueNames = [...new Set(tools.map((t) => t.toolName))]
  const summaryBadges = uniqueNames.slice(0, 3)
  const moreCount = uniqueNames.length - summaryBadges.length

  return (
    <div className="tool-group">
      <button
        className="tool-group__header"
        type="button"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="tool-group__chevron">{collapsed ? "▶" : "▼"}</span>
        <span className="tool-group__title">Tool calls</span>
        <span className="tool-group__count">{tools.length}</span>
        <div className="tool-group__badges">
          {summaryBadges.map((name) => (
            <span key={name} className="tool-group__badge">{name}</span>
          ))}
          {moreCount > 0 && (
            <span className="tool-group__badge tool-group__badge--more">+{moreCount}</span>
          )}
        </div>
      </button>
      {!collapsed && (
        <div className="tool-group__body">
          {tools.map((tool) => (
            <ToolActivityEntry key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
