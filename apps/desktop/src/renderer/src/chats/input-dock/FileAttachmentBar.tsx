import { type ReactElement } from "react"
import "./FileAttachmentBar.css"

export type FileAttachmentBarProps = {
  files: File[]
  onRemove: (index: number) => void
}

function truncateFilename(name: string, maxLength: number = 30): string {
  if (name.length <= maxLength) return name
  const ext = name.split(".").pop()
  const extLength = ext ? ext.length + 1 : 0
  const availableLength = maxLength - extLength - 3 // -3 for "..."
  return name.slice(0, availableLength) + "..." + (ext ? "." + ext : "")
}

function getFileIcon(file: File): string {
  return file.type.startsWith("image/") ? "🖼" : "📄"
}

export function FileAttachmentBar({
  files,
  onRemove,
}: FileAttachmentBarProps): ReactElement | null {
  if (files.length === 0) {
    return null
  }

  return (
    <div className="input-dock__file-bar">
      {files.map((file, index) => (
        <div key={index} className="input-dock__file-badge">
          <span className="input-dock__file-badge-icon">
            {getFileIcon(file)}
          </span>
          <span className="input-dock__file-badge-name">
            {truncateFilename(file.name)}
          </span>
          <button
            className="input-dock__file-badge-remove"
            onClick={() => onRemove(index)}
            type="button"
            aria-label={`Remove ${file.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
