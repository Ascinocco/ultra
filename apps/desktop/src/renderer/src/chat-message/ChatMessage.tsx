import { useState, type ReactElement } from "react"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { copyToClipboard } from "./copy-to-clipboard"
import "./ChatMessage.css"

interface AttachmentMeta {
  name: string
  type: "image" | "text"
  media_type: string
}

interface ChatMessageProps {
  role: "user" | "coordinator" | "assistant" | "system"
  content: string
  isStreaming?: boolean
  attachments?: AttachmentMeta[]
}

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  coordinator: "Assistant",
  assistant: "Assistant",
  system: "System",
}

const ASSISTANT_ROLES = new Set(["coordinator", "assistant"])

function AttachmentIcon({ type }: { type: "image" | "text" }) {
  if (type === "image") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <circle cx="5.5" cy="5.5" r="1.5" />
        <path d="M14.5 10.5l-3.5-3.5-7.5 7.5" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4a1.5 1.5 0 00-1.5 1.5v11A1.5 1.5 0 004 15.5h8a1.5 1.5 0 001.5-1.5V5.5L9.5 1.5z" />
      <path d="M9.5 1.5V5.5h4" />
      <line x1="5.5" y1="8.5" x2="10.5" y2="8.5" />
      <line x1="5.5" y1="11" x2="10.5" y2="11" />
    </svg>
  )
}

export function ChatMessage({ role, content, isStreaming, attachments }: ChatMessageProps): ReactElement | null {
  const [copied, setCopied] = useState(false)

  if (!content.trim() && !isStreaming) return null

  const label = ROLE_LABELS[role] || role

  const handleCopy = async () => {
    const success = await copyToClipboard(content)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const isAssistant = ASSISTANT_ROLES.has(role)
  const cssRole = isAssistant ? "coordinator" : role

  return (
    <div className={"chat-message chat-message--" + cssRole}>
      <div className="chat-message__label">{label}</div>
      <div className="chat-message__content">
        {isStreaming && !content.trim() ? (
          <div className="chat-message__typing">
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
          </div>
        ) : isAssistant ? (
          <MarkdownRenderer content={content} />
        ) : (
          <p className="chat-message__text">{content}</p>
        )}
        {attachments && attachments.length > 0 && (
          <div className="chat-message__attachments">
            {attachments.map((att, i) => (
              <span key={i} className={`chat-message__attachment-badge chat-message__attachment-badge--${att.type}`}>
                <AttachmentIcon type={att.type} />
                {att.name}
              </span>
            ))}
          </div>
        )}
      </div>
      {isAssistant && content.trim() && (
        <button
          className="chat-message__copy"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied!" : "Copy message"}
        </button>
      )}
    </div>
  )
}
