import { type ReactElement, useEffect, useRef, useState } from "react"
import "./project-settings-modal.css"

type Props = {
  projectId: string
  currentFilePaths: string[]
  onSave: (filePaths: string[]) => void
  onClose: () => void
}

export function ProjectSettingsModal({
  projectId,
  currentFilePaths,
  onSave,
  onClose,
}: Props): ReactElement {
  const [value, setValue] = useState(currentFilePaths.join(", "))
  const overlayRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) {
      onClose()
    }
  }

  function handleSave() {
    const paths = value
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    onSave(paths)
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose()
    }
  }

  return (
    <div
      className="project-settings-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className="project-settings-modal">
        <div className="project-settings-modal__header">
          <h3 className="project-settings-modal__title">Project Settings</h3>
          <button
            className="project-settings-modal__close"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="project-settings-modal__body">
          <label className="project-settings-modal__label">
            Cross-sandbox files
          </label>
          <p className="project-settings-modal__description">
            Files synced from main into your sandbox when you switch into it.
            Comma-separated, relative to project root. Example: <code>.env</code>
          </p>
          <textarea
            ref={textareaRef}
            className="project-settings-modal__textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder=".env, .env.local"
            rows={3}
          />
        </div>
        <div className="project-settings-modal__footer">
          <button
            className="project-settings-modal__btn project-settings-modal__btn--cancel"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="project-settings-modal__btn project-settings-modal__btn--save"
            type="button"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
