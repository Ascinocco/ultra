import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useRef,
  useState,
} from "react"
import { FileAttachmentBar } from "./FileAttachmentBar.js"
import { ToolbarPill } from "./ToolbarPill.js"
import "./input-dock.css"

export type InputDockProps = {
  chatId: string
  disabled: boolean
  isFirstTurn: boolean
  provider: string
  model: string
  thinkingLevel: string
  permissionLevel: string
  availableModels: string[]
  onPlanMarker?: (markerType: "open" | "close") => void
  onPromote?: () => void
  planMarkerOpen?: boolean
  onSend: (prompt: string, attachments: File[]) => void
  onRuntimeConfigChange: (config: {
    provider?: string
    model?: string
    thinkingLevel?: string
    permissionLevel?: string
  }) => void
}

const THINKING_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
]

const PERMISSION_OPTIONS = [
  { value: "full_access", label: "Full access" },
  { value: "supervised", label: "Supervised" },
]

export function InputDock({
  chatId,
  disabled,
  isFirstTurn,
  provider,
  model,
  thinkingLevel,
  permissionLevel,
  availableModels,
  onPlanMarker,
  onPromote,
  planMarkerOpen,
  onSend,
  onRuntimeConfigChange,
}: InputDockProps): ReactElement {
  const [prompt, setPrompt] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  const modelOptions = availableModels.map((m) => ({ value: m, label: m }))

  const thinkingLabel =
    THINKING_OPTIONS.find((o) => o.value === thinkingLevel)?.label ?? thinkingLevel
  const permissionLabel =
    PERMISSION_OPTIONS.find((o) => o.value === permissionLevel)?.label ?? permissionLevel

  const pillsReadOnly = !isFirstTurn

  const handleTextareaChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = prompt.trim()
    if (trimmed === "/plan") {
      onPlanMarker?.(planMarkerOpen ? "close" : "open")
      setPrompt("")
      return
    }
    if (trimmed === "/promote") {
      onPromote?.()
      setPrompt("")
      return
    }
    if (!trimmed && files.length === 0) return
    onSend(trimmed, files)
    setPrompt("")
    setFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [prompt, files, onSend, onPlanMarker, onPromote, planMarkerOpen])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (!disabled) {
          handleSend()
        }
      }
    },
    [disabled, handleSend],
  )

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
    }
    e.target.value = ""
  }, [])

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
    }
  }, [])

  return (
    <div
      className="input-dock"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="input-dock__textarea-area">
        <textarea
          ref={textareaRef}
          className="input-dock__textarea"
          placeholder="Message…"
          value={prompt}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          readOnly={disabled}
          rows={1}
        />
      </div>

      <FileAttachmentBar files={files} onRemove={handleRemoveFile} />

      <div className="input-dock__toolbar">
        <button
          type="button"
          className="input-dock__attach"
          onClick={handleAttachClick}
          aria-label="Attach file"
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.pdf"
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />

        <ToolbarPill
          label={model}
          options={modelOptions}
          value={model}
          onChange={(value) => onRuntimeConfigChange({ model: value })}
          readOnly={pillsReadOnly}
        />
        <ToolbarPill
          label={thinkingLabel}
          options={THINKING_OPTIONS}
          value={thinkingLevel}
          onChange={(value) => onRuntimeConfigChange({ thinkingLevel: value })}
          readOnly={pillsReadOnly}
        />
        <ToolbarPill
          label="Full access"
          icon="🛡"
          options={PERMISSION_OPTIONS}
          value="full_access"
          onChange={() => {}}
          readOnly
        />

        <span className="input-dock__spacer" />

        <button
          type="button"
          className="input-dock__send"
          onClick={handleSend}
          disabled={disabled || (!prompt.trim() && files.length === 0)}
          aria-label="Send message"
        >
          ↑
        </button>
      </div>

      {dragging ? (
        <div className="input-dock__drop-overlay">
          Drop files to attach
        </div>
      ) : null}
    </div>
  )
}
