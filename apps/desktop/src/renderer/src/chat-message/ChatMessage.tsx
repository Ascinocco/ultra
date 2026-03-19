import { useState, type ReactElement } from "react"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { copyToClipboard } from "./copy-to-clipboard"
import "./ChatMessage.css"

interface ChatMessageProps {
  role: "user" | "coordinator" | "system"
  content: string
}

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  coordinator: "Assistant",
  system: "System",
}

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

  return (
    <div className={"chat-message chat-message--" + role}>
      <div className="chat-message__label">{label}</div>
      <div className="chat-message__content">
        {role === "coordinator" ? (
          <MarkdownRenderer content={content} />
        ) : (
          <p className="chat-message__text">{content}</p>
        )}
      </div>
      {role === "coordinator" && (
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
