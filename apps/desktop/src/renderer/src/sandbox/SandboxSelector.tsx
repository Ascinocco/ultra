import type { SandboxContextSnapshot } from "@ultra/shared"
import { useEffect, useRef, useState } from "react"

export function SandboxSelector({
  activeSandbox,
  sandboxes,
  onSelect,
}: {
  activeSandbox: SandboxContextSnapshot | null
  sandboxes: SandboxContextSnapshot[]
  onSelect: (sandboxId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [open])

  const label = activeSandbox?.displayName ?? "No sandbox"

  return (
    <div className="sandbox-selector" ref={ref}>
      <button
        className="sandbox-selector__pill"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <svg
          className="sandbox-selector__icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 2v6.5L3.5 6M6 8.5L8.5 6M10 14V7.5l2.5 2.5M10 7.5L7.5 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sandbox-selector__label">{label}</span>
        <svg
          className="sandbox-selector__chevron"
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="sandbox-selector__dropdown" role="listbox">
          {sandboxes.map((sb) => (
            <button
              key={sb.sandboxId}
              className={`sandbox-selector__option ${
                sb.sandboxId === activeSandbox?.sandboxId
                  ? "sandbox-selector__option--active"
                  : ""
              }`}
              type="button"
              role="option"
              aria-selected={sb.sandboxId === activeSandbox?.sandboxId}
              onClick={() => {
                onSelect(sb.sandboxId)
                setOpen(false)
              }}
            >
              {sb.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
