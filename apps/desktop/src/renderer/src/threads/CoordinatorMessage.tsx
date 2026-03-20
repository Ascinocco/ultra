import type { ThreadMessageSnapshot } from "@ultra/shared"

export function getMessageClass(message: ThreadMessageSnapshot): string {
  if (message.role === "system") {
    return `coord-msg coord-msg--system${message.partial ? " coord-msg--streaming" : ""}`
  }

  const typeClass = message.messageType.replace(/_/g, "-")
  const base = `coord-msg coord-msg--${typeClass}`
  const roleClass = ` coord-msg--role-${message.role}`
  const streamClass = message.partial ? " coord-msg--streaming" : ""
  return `${base}${roleClass}${streamClass}`
}

export function CoordinatorMessage({
  message,
}: {
  message: ThreadMessageSnapshot
}) {
  return (
    <div className={getMessageClass(message)}>
      <div className="coord-msg__content">{message.content.text}</div>
      {message.partial && (
        <span className="coord-msg__streaming-indicator" aria-label="Streaming">
          ...
        </span>
      )}
    </div>
  )
}
