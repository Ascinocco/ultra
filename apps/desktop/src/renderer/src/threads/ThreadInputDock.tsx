import { useRef, useState, useCallback } from "react"
import { FileAttachmentBar } from "../chats/input-dock/FileAttachmentBar.js"

type Props = {
  disabled: boolean
  disabledReason?: string | undefined
  showWaitingIndicator?: boolean | undefined
  onSend: (content: string, files: File[]) => void
  model?: string | undefined
}

export function ThreadInputDock({
  disabled,
  disabledReason,
  showWaitingIndicator,
  onSend,
  model,
}: Props) {
  const [value, setValue] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed && files.length === 0) return
    onSend(trimmed, files)
    setValue("")
    setFiles([])
  }, [value, files, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (!disabled) handleSend()
      }
    },
    [disabled, handleSend],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newFiles = e.target.files
      if (!newFiles) return
      setFiles((prev) => [...prev, ...Array.from(newFiles)])
      e.target.value = ""
    },
    [],
  )

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFiles = e.dataTransfer.files
    setFiles((prev) => [...prev, ...Array.from(droppedFiles)])
  }, [])

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <div
      className="thread-input-dock"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {showWaitingIndicator && (
        <div className="thread-input-dock__waiting">
          <span className="thread-input-dock__waiting-dot" />
          Waiting for your response
        </div>
      )}
      {files.length > 0 && (
        <FileAttachmentBar
          files={files}
          onRemove={removeFile}
        />
      )}
      <div className="thread-input-dock__row">
        <button
          type="button"
          className="thread-input-dock__attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach file"
        >
          +
        </button>
        <textarea
          ref={textareaRef}
          className="thread-input-dock__textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabledReason ?? "Message coordinator..."}
          disabled={disabled}
          rows={1}
        />
        <button
          type="button"
          className="thread-input-dock__send"
          onClick={handleSend}
          disabled={disabled || (!value.trim() && files.length === 0)}
          aria-label="Send message"
        >
          Send
        </button>
      </div>
      {model && (
        <div className="thread-input-dock__pills">
          <span className="thread-input-dock__pill">{model}</span>
          <span className="thread-input-dock__pill">Full access</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleFileSelect}
      />
    </div>
  )
}
