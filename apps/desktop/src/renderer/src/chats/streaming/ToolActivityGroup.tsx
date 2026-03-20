import { type ReactElement, useState, useRef, useEffect } from "react"
import type { ToolEntry } from "./streaming-types.js"
import { ToolActivityEntry } from "./ToolActivityEntry.js"

type Props = {
  tools: ToolEntry[]
  collapsed: boolean
}

export function ToolActivityGroup({ tools, collapsed: initialCollapsed }: Props): ReactElement {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new tools arrive
  useEffect(() => {
    if (bodyRef.current && !collapsed) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [tools.length, collapsed])

  const uniqueNames = [...new Set(tools.map((t) => t.toolName))]
  const summaryBadges = uniqueNames.slice(0, 3)
  const moreCount = uniqueNames.length - summaryBadges.length

  return (
    <div className={`tool-group ${expanded ? "tool-group--expanded" : ""}`}>
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
        <>
          <div className="tool-group__body" ref={bodyRef}>
            {tools.map((tool) => (
              <ToolActivityEntry key={tool.id} tool={tool} />
            ))}
          </div>
          {tools.length > 5 && (
            <div className="tool-group__footer">
              <button
                className="tool-group__expand-btn"
                type="button"
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
