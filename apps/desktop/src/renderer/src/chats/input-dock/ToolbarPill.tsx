import { type ReactElement, useEffect, useRef, useState } from "react"

export type ToolbarPillProps = {
  label: string
  icon?: string
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

export function ToolbarPill({
  label,
  icon,
  options,
  value,
  onChange,
  readOnly = false,
}: ToolbarPillProps): ReactElement {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  function handleButtonClick(): void {
    if (!readOnly) {
      setOpen((prev) => !prev)
    }
  }

  function handleOptionClick(optionValue: string): void {
    onChange(optionValue)
    setOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className={`input-dock__pill${readOnly ? " input-dock__pill--readonly" : ""}`}
        onClick={handleButtonClick}
        disabled={readOnly}
      >
        {icon ? <span className="input-dock__pill-icon">{icon}</span> : null}
        <span className="input-dock__pill-label">{label}</span>
        {!readOnly ? <span className="input-dock__pill-arrow">▾</span> : null}
      </button>
      {open && !readOnly ? (
        <div className="input-dock__pill-menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`input-dock__pill-option${option.value === value ? " input-dock__pill-option--selected" : ""}`}
              onClick={() => handleOptionClick(option.value)}
            >
              {option.value === value ? <span>✓ </span> : null}
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
