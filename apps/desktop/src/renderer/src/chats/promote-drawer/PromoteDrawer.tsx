import { useState, type ReactElement } from "react"
import "./promote-drawer.css"

type PlanState = "idle" | "planning" | "ready"

type Props = {
  messageCount: number
  planState: PlanState
  promoting: boolean
  hasPromotedRecently: boolean
  onStartPlan: () => void
  onFinishPlan: () => void
  onNewPlan: () => void
  onPromote: () => void
}

function ChevronUp() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 6L8 2L13 6" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="14" height="7" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 2L8 6L13 2" />
    </svg>
  )
}

function DiscardPlanModal({ onConfirm, onCancel }: {
  onConfirm: (dontShowAgain: boolean) => void
  onCancel: () => void
}) {
  const [dontShow, setDontShow] = useState(false)

  return (
    <div className="plan-action-bar__modal-overlay" onClick={onCancel}>
      <div className="plan-action-bar__modal" onClick={(e) => e.stopPropagation()}>
        <p className="plan-action-bar__modal-title">Discard current plan?</p>
        <p className="plan-action-bar__modal-text">
          Starting a new plan will discard the current plan markers.
          The conversation is preserved, but the promote context will
          reset to the new plan.
        </p>
        <label className="plan-action-bar__modal-check">
          <input type="checkbox" checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)} />
          Don't show this again
        </label>
        <div className="plan-action-bar__modal-actions">
          <button className="plan-action-bar__btn" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="plan-action-bar__btn plan-action-bar__btn--promote"
            onClick={() => onConfirm(dontShow)} type="button">
            Start New Plan
          </button>
        </div>
      </div>
    </div>
  )
}

const DONT_SHOW_KEY = "ultra.plan.skipDiscardConfirm"

export function PromoteDrawer({
  messageCount,
  planState,
  promoting,
  hasPromotedRecently,
  onStartPlan,
  onFinishPlan,
  onNewPlan,
  onPromote,
}: Props): ReactElement | null {
  const [manualCollapse, setManualCollapse] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showDiscardModal, setShowDiscardModal] = useState(false)

  if (messageCount < 3 && !promoting && planState === "idle") return null

  // Auto-expand when planning/ready, but respect manual collapse
  const isExpanded = promoting || (manualCollapse ? false : (expanded || planState !== "idle"))

  // Creating thread state
  if (promoting) {
    return (
      <div className="plan-action-bar__bar plan-action-bar__bar--creating">
        <div className="plan-action-bar__left">
          <span className="plan-action-bar__status plan-action-bar__status--creating">
            Creating thread...
          </span>
          <span className="plan-action-bar__count">generating title</span>
        </div>
        <div className="plan-action-bar__right">
          <button className="plan-action-bar__btn" disabled type="button">
            Creating...
          </button>
        </div>
      </div>
    )
  }

  // Collapsed lip
  if (!isExpanded) {
    return (
      <div className="plan-action-bar__lip" onClick={() => { setExpanded(true); setManualCollapse(false) }}>
        <ChevronUp />
      </div>
    )
  }

  function handleNewPlan() {
    const skipConfirm = localStorage.getItem(DONT_SHOW_KEY) === "true"
    if (skipConfirm) {
      onNewPlan()
    } else {
      setShowDiscardModal(true)
    }
  }

  function handleDiscardConfirm(dontShowAgain: boolean) {
    if (dontShowAgain) {
      localStorage.setItem(DONT_SHOW_KEY, "true")
    }
    setShowDiscardModal(false)
    onNewPlan()
  }

  const canPromote = messageCount > 0 && !hasPromotedRecently

  return (
    <>
      {showDiscardModal && (
        <DiscardPlanModal
          onConfirm={handleDiscardConfirm}
          onCancel={() => setShowDiscardModal(false)}
        />
      )}
      <div className={`plan-action-bar__bar${
        planState === "planning" ? " plan-action-bar__bar--planning" :
        planState === "ready" ? " plan-action-bar__bar--ready" : ""
      }`}>
        {planState === "idle" && (
          <>
            <div className="plan-action-bar__left">
              <button className="plan-action-bar__btn" onClick={onStartPlan} type="button">
                Start Plan
              </button>
            </div>
            <div className="plan-action-bar__right">
              <span className="plan-action-bar__count">{messageCount} messages</span>
              <button className="plan-action-bar__btn plan-action-bar__btn--promote"
                disabled={!canPromote} onClick={onPromote} type="button">
                ⬆ Promote
              </button>
              <span className="plan-action-bar__chevron" onClick={() => { setExpanded(false); setManualCollapse(true) }}>
                <ChevronDown />
              </span>
            </div>
          </>
        )}

        {planState === "planning" && (
          <>
            <div className="plan-action-bar__left">
              <span className="plan-action-bar__dot" />
              <span className="plan-action-bar__status">Planning</span>
              <span className="plan-action-bar__count">· {messageCount} messages</span>
            </div>
            <div className="plan-action-bar__right">
              <button className="plan-action-bar__btn" onClick={onFinishPlan} type="button">
                Finish Plan
              </button>
              <span className="plan-action-bar__chevron" onClick={() => { setExpanded(false); setManualCollapse(true) }}>
                <ChevronDown />
              </span>
            </div>
          </>
        )}

        {planState === "ready" && (
          <>
            <div className="plan-action-bar__left">
              <span className="plan-action-bar__check">✓</span>
              <span className="plan-action-bar__status plan-action-bar__status--ready">
                Plan complete
              </span>
              <span className="plan-action-bar__count">· {messageCount} messages</span>
            </div>
            <div className="plan-action-bar__right">
              <button className="plan-action-bar__btn" onClick={handleNewPlan} type="button">
                New Plan
              </button>
              <button className="plan-action-bar__btn plan-action-bar__btn--promote"
                disabled={!canPromote} onClick={onPromote} type="button">
                ⬆ Promote
              </button>
              <span className="plan-action-bar__chevron" onClick={() => { setExpanded(false); setManualCollapse(true) }}>
                <ChevronDown />
              </span>
            </div>
          </>
        )}
      </div>
    </>
  )
}
