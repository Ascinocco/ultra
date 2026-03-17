import { useEffect, useRef, useState } from "react"

type Provider = "claude" | "codex"

const CLAUDE_MODELS = ["sonnet-4-6", "opus-4-6", "haiku-4-5"]
const CODEX_MODELS = ["gpt-5.4"]

export function TerminalCommandBar({
  visible,
  provider,
  model,
  generating = false,
  streamingText = "",
  error = null,
  onSubmit,
  onCancel,
  onProviderChange,
  onModelChange,
  availableProviders,
}: {
  visible: boolean
  provider: Provider
  model: string
  generating?: boolean
  streamingText?: string
  error?: string | null
  onSubmit: (prompt: string) => void
  onCancel: () => void
  onProviderChange: (provider: Provider) => void
  onModelChange: (model: string) => void
  availableProviders: Provider[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus()
    }
    if (!visible) {
      setInputValue("")
      setDropdownOpen(false)
    }
  }, [visible])

  if (!visible) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
      return
    }

    if (e.key === "Enter" && !generating) {
      e.preventDefault()
      if (inputValue.trim()) {
        onSubmit(inputValue.trim())
      }
    }
  }

  const handleModelSelect = (newProvider: Provider, newModel: string) => {
    onProviderChange(newProvider)
    onModelChange(newModel)
    setDropdownOpen(false)
  }

  if (error) {
    return (
      <div className="terminal-command-bar terminal-command-bar--error">
        <span className="terminal-command-bar__error-text">{error}</span>
        <button
          type="button"
          className="terminal-command-bar__retry"
          onClick={() => onSubmit(inputValue.trim())}
        >
          Retry
        </button>
        <button
          type="button"
          className="terminal-command-bar__kbd"
          onClick={onCancel}
        >
          Esc
        </button>
      </div>
    )
  }

  if (generating) {
    return (
      <div className="terminal-command-bar terminal-command-bar--generating">
        <div className="terminal-command-bar__spinner" />
        <span className="terminal-command-bar__generating-label">
          Generating command...
        </span>
        {streamingText && (
          <code className="terminal-command-bar__streaming-text">
            {streamingText}
          </code>
        )}
        <button
          type="button"
          className="terminal-command-bar__kbd"
          onClick={onCancel}
        >
          Esc
        </button>
      </div>
    )
  }

  return (
    <div className="terminal-command-bar">
      <span className="terminal-command-bar__badge">⌘K</span>
      <input
        ref={inputRef}
        className="terminal-command-bar__input"
        type="text"
        placeholder="Describe a command..."
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="terminal-command-bar__model-picker">
        <button
          type="button"
          className="terminal-command-bar__model-trigger"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          disabled={generating}
        >
          {provider === "claude" && (
            <span className="terminal-command-bar__provider-icon terminal-command-bar__provider-icon--claude">
              C
            </span>
          )}
          <span className="terminal-command-bar__model-name">{model}</span>
          <span className="terminal-command-bar__chevron">
            {dropdownOpen ? "▴" : "▾"}
          </span>
        </button>
        {dropdownOpen && (
          <div className="terminal-command-bar__dropdown">
            {availableProviders.includes("claude") && (
              <>
                <div className="terminal-command-bar__dropdown-header">
                  Claude
                </div>
                {CLAUDE_MODELS.map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={`terminal-command-bar__dropdown-item ${
                      provider === "claude" && model === m
                        ? "terminal-command-bar__dropdown-item--selected"
                        : ""
                    }`}
                    onClick={() => handleModelSelect("claude", m)}
                  >
                    {m}
                    {provider === "claude" && model === m && (
                      <span className="terminal-command-bar__check">✓</span>
                    )}
                  </button>
                ))}
              </>
            )}
            {availableProviders.includes("codex") && (
              <>
                <div className="terminal-command-bar__dropdown-header">
                  Codex
                </div>
                {CODEX_MODELS.map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={`terminal-command-bar__dropdown-item ${
                      provider === "codex" && model === m
                        ? "terminal-command-bar__dropdown-item--selected"
                        : ""
                    }`}
                    onClick={() => handleModelSelect("codex", m)}
                  >
                    {m}
                    {provider === "codex" && model === m && (
                      <span className="terminal-command-bar__check">✓</span>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
