import { useState, type ReactElement } from "react"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { copyToClipboard } from "./copy-to-clipboard"
import "./ChatMessage.css"

interface ChatMessageProps {
  role: "user" | "coordinator" | "assistant" | "system"
  content: string
}

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  coordinator: "Assistant",
  assistant: "Assistant",
  system: "System",
}

const ASSISTANT_ROLES = new Set(["coordinator", "assistant"])

export function ChatMessage({ role, content }: ChatMessageProps): ReactElement | null {
  const [copied, setCopied] = useState(false)

  if (!content.trim()) return null

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
        {isAssistant ? (
          <MarkdownRenderer content={content} />
        ) : (
          <p className="chat-message__text">{content}</p>
        )}
      </div>
      {isAssistant && (
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
