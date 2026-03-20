import type { ReactElement } from "react"
import type { ToolEntry } from "./streaming-types.js"

const ICON_MAP: Record<string, string> = {
  terminal: "⚡",
  file: "📄",
  pencil: "✏️",
  search: "🔍",
  globe: "🌐",
  tool: "🔧",
}

export function ToolActivityEntry({ tool }: { tool: ToolEntry }): ReactElement {
  const icon = ICON_MAP[tool.icon] ?? "🔧"
  return (
    <div className="tool-entry">
      <span className="tool-entry__icon">{icon}</span>
      <span className="tool-entry__name">{tool.toolName}</span>
      {tool.detail && (
        <span className="tool-entry__detail">{tool.detail}</span>
      )}
      <span className={`tool-entry__status tool-entry__status--${tool.status}`}>
        {tool.status === "running" && "●"}
        {tool.status === "done" && "✓"}
        {tool.status === "error" && "✗"}
      </span>
    </div>
  )
}
