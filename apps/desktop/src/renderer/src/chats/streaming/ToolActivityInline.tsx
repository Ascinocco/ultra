import { type ReactElement, useState } from "react"
import type { ToolEntry } from "./streaming-types.js"
import { normalizeToolLabel } from "./tool-map.js"

type Props = {
  tools: ToolEntry[]
}

const VERB_MAP: Record<string, string> = {
  bash: "Ran",
  Read: "Read",
  Edit: "Edited",
  Write: "Wrote",
  Grep: "Searched",
  Glob: "Searched",
  WebSearch: "Searched",
  WebFetch: "Fetched",
  commandExecution: "Ran",
  command_execution: "Ran",
  fileChange: "Edited",
  file_change: "Edited",
  fileRead: "Read",
  file_read: "Read",
}

function getVerb(toolName: string): string {
  return VERB_MAP[toolName] ?? "Called"
}

function formatDetail(tool: ToolEntry): string {
  if (tool.detail) return tool.detail
  return normalizeToolLabel(tool.toolName)
}

/** Group consecutive tools of the same type for summary display */
function groupTools(tools: ToolEntry[]): Array<{ type: string; tools: ToolEntry[] }> {
  const groups: Array<{ type: string; tools: ToolEntry[] }> = []
  for (const tool of tools) {
    const last = groups[groups.length - 1]
    if (last && last.type === tool.toolName) {
      last.tools.push(tool)
    } else {
      groups.push({ type: tool.toolName, tools: [tool] })
    }
  }
  return groups
}

function ToolLine({ tool }: { tool: ToolEntry }): ReactElement {
  const verb = getVerb(tool.toolName)
  const detail = formatDetail(tool)
  const isRunning = tool.status === "running"

  return (
    <div className={`tool-inline ${isRunning ? "tool-inline--running" : ""}`}>
      <span className="tool-inline__verb">{verb}</span>
      {" "}
      <span className="tool-inline__detail">{detail}</span>
      {isRunning && <span className="tool-inline__dot">●</span>}
    </div>
  )
}

function ToolSummary({ group }: { group: { type: string; tools: ToolEntry[] } }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const verb = getVerb(group.type)
  const count = group.tools.length
  const isRunning = group.tools.some((t) => t.status === "running")

  // For file reads, show as "Explored N files"
  const isFileOp = ["Read", "fileRead", "file_read"].includes(group.type)
  const label = isFileOp
    ? `Explored ${count} files`
    : `${verb} ${count} ${normalizeToolLabel(group.type).toLowerCase()}s`

  return (
    <div className="tool-inline-group">
      <button
        className={`tool-inline tool-inline--summary ${isRunning ? "tool-inline--running" : ""}`}
        type="button"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="tool-inline__verb">{label}</span>
        <span className="tool-inline__chevron">{expanded ? "▾" : "▸"}</span>
        {isRunning && <span className="tool-inline__dot">●</span>}
      </button>
      {expanded && (
        <div className="tool-inline-group__details">
          {group.tools.map((tool) => (
            <div key={tool.id} className="tool-inline-group__item">
              {getVerb(tool.toolName)} {formatDetail(tool)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ToolActivityInline({ tools }: Props): ReactElement {
  const groups = groupTools(tools)

  return (
    <div className="tool-inline-container">
      {groups.map((group, i) => {
        if (group.tools.length === 1) {
          return <ToolLine key={group.tools[0].id} tool={group.tools[0]} />
        }
        return <ToolSummary key={`group-${i}`} group={group} />
      })}
    </div>
  )
}
