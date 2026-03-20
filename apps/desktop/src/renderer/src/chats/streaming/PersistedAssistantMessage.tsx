import type { ReactElement } from "react"
import { ToolActivityInline } from "./ToolActivityInline.js"
import { MarkdownRenderer } from "../../chat-message/MarkdownRenderer.js"
import { getToolConfig } from "./tool-map.js"
import type { ToolEntry } from "./streaming-types.js"

type PersistedBlock =
  | { type: "text"; content: string }
  | { type: "tools"; tools: Array<{ name: string; detail: string }> }

type Props = {
  blocks: PersistedBlock[]
}

function toToolEntries(tools: Array<{ name: string; detail: string }>): ToolEntry[] {
  return tools.map((t, i) => ({
    id: `persisted-${i}`,
    toolName: t.name,
    detail: t.detail,
    icon: getToolConfig(t.name).icon,
    status: "done" as const,
  }))
}

export function PersistedAssistantMessage({ blocks }: Props): ReactElement {
  return (
    <div className="chat-message chat-message--coordinator">
      <div className="chat-message__label">Assistant</div>
      <div className="chat-message__content">
        {blocks.map((block, i) => {
          if (block.type === "text") {
            return block.content ? (
              <MarkdownRenderer key={`text-${i}`} content={block.content} />
            ) : null
          }
          if (block.type === "tools") {
            return (
              <ToolActivityInline
                key={`tools-${i}`}
                tools={toToolEntries(block.tools)}
              />
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
