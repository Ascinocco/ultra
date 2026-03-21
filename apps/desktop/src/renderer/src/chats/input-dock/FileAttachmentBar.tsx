import { type ReactElement } from "react"
import "./input-dock.css"

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

function FileIcon({ isImage }: { isImage: boolean }) {
  if (isImage) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <circle cx="5.5" cy="5.5" r="1.5" />
        <path d="M14.5 10.5l-3.5-3.5-7.5 7.5" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4a1.5 1.5 0 00-1.5 1.5v11A1.5 1.5 0 004 15.5h8a1.5 1.5 0 001.5-1.5V5.5L9.5 1.5z" />
      <path d="M9.5 1.5V5.5h4" />
      <line x1="5.5" y1="8.5" x2="10.5" y2="8.5" />
      <line x1="5.5" y1="11" x2="10.5" y2="11" />
    </svg>
  )
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
            <FileIcon isImage={file.type.startsWith("image/")} />
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
