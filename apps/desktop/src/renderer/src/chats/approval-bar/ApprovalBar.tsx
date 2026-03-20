import { type ReactElement, useState } from "react"
import type { ApprovalStep } from "../hooks/useApprovalState.js"
import "./ApprovalBar.css"

export interface ApprovalBarProps {
  step: ApprovalStep
  threadTitle: string | null
  onApprovePlan: () => Promise<void>
  onApproveSpecs: () => Promise<void>
  onStartWork: () => Promise<void>
}

const STEP_LABELS = ["Plan", "Specs", "Start Work"] as const
const STEP_THRESHOLDS: ApprovalStep[] = ["plan", "specs", "start"]

const BUTTON_CONFIG: Record<
  Exclude<ApprovalStep, "complete">,
  { label: string; className: string }
> = {
  plan: { label: "Approve Plan", className: "" },
  specs: { label: "Approve Specs", className: "" },
  start: { label: "Start Work", className: "approval-bar__action--start" },
}

export function ApprovalBar({
  step,
  threadTitle,
  onApprovePlan,
  onApproveSpecs,
  onStartWork,
}: ApprovalBarProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (step === "complete") {
    return (
      <div className="approval-bar approval-bar--complete">
        <span className="approval-bar__complete-check" aria-hidden="true">
          ✓
        </span>
        <span className="approval-bar__complete-label">Thread started</span>
        {threadTitle ? (
          <span className="approval-bar__complete-title">
            · {threadTitle}
          </span>
        ) : null}
      </div>
    )
  }

  const handlers: Record<Exclude<ApprovalStep, "complete">, () => Promise<void>> = {
    plan: onApprovePlan,
    specs: onApproveSpecs,
    start: onStartWork,
  }

  async function handleClick(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await handlers[step]()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed")
      setTimeout(() => setError(null), 3000)
    } finally {
      setBusy(false)
    }
  }

  const config = BUTTON_CONFIG[step]

  return (
    <div className="approval-bar">
      <div className="approval-bar__steps">
        {STEP_LABELS.map((label, i) => {
          const stepIndex = STEP_THRESHOLDS.indexOf(step)
          const done = i < stepIndex
          const active = i === stepIndex

          return (
            <div className="approval-bar__step-group" key={label}>
              {i > 0 && (
                <div
                  className={`approval-bar__connector ${done || active ? "approval-bar__connector--done" : ""}`}
                />
              )}
              <div
                className={`approval-bar__step ${done ? "approval-bar__step--done" : ""} ${active ? "approval-bar__step--active" : ""}`}
              >
                {done ? (
                  <span className="approval-bar__step-check">✓</span>
                ) : (
                  <span className="approval-bar__step-number">{i + 1}</span>
                )}
              </div>
              <span
                className={`approval-bar__step-label ${done ? "approval-bar__step-label--done" : ""} ${active ? "approval-bar__step-label--active" : ""}`}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
      <div className="approval-bar__actions">
        {error ? (
          <span className="approval-bar__error">{error}</span>
        ) : null}
        <button
          className={`approval-bar__action ${config.className}`}
          onClick={handleClick}
          disabled={busy}
          type="button"
        >
          {busy ? "Working…" : config.label}
        </button>
      </div>
    </div>
  )
}
