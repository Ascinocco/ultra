import type { ReactElement } from "react"
import type { StreamingBlock } from "./streaming-types.js"
import { ToolActivityInline } from "./ToolActivityInline.js"
import { MarkdownRenderer } from "../../chat-message/MarkdownRenderer.js"
import "./streaming.css"

type Props = {
  blocks: StreamingBlock[]
  isStreaming: boolean
}

export function StreamingMessage({ blocks, isStreaming }: Props): ReactElement {
  const hasContent = blocks.some(
    (b) => (b.type === "text" && b.content.length > 0) || b.type === "tool_group",
  )

  const lastBlock = blocks[blocks.length - 1]
  const showWaiting = !isStreaming && hasContent && lastBlock?.type === "text"

  return (
    <div className="streaming-message chat-message chat-message--coordinator">
      <div className="chat-message__label">Assistant</div>
      <div className="chat-message__content">
        {!hasContent && isStreaming ? (
          <div className="chat-message__typing">
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
          </div>
        ) : (
          blocks.map((block, i) => {
            if (block.type === "text") {
              return block.content ? (
                <MarkdownRenderer key={`text-${i}`} content={block.content} />
              ) : null
            }
            return (
              <ToolActivityInline
                key={block.id}
                tools={block.tools}
              />
            )
          })
        )}
        {showWaiting && (
          <div className="streaming-message__waiting">
            <span className="streaming-message__waiting-dot" />
            Waiting for your response
          </div>
        )}
      </div>
    </div>
  )
}
