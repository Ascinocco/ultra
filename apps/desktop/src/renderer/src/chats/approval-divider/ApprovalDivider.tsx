import type { ReactElement } from "react"
import "./ApprovalDivider.css"

export interface ApprovalDividerProps {
  messageType: "plan_approval" | "spec_approval" | "thread_start_request" | "plan_marker_open" | "plan_marker_close"
}

const LABELS: Record<ApprovalDividerProps["messageType"], string> = {
  plan_approval: "Plan approved",
  spec_approval: "Specs approved",
  thread_start_request: "Thread created",
  plan_marker_open: "Plan started",
  plan_marker_close: "Plan closed",
}

export function ApprovalDivider({
  messageType,
}: ApprovalDividerProps): ReactElement {
  return (
    <div className="approval-divider" role="separator">
      <div className="approval-divider__line" />
      <span className="approval-divider__label">
        <span className="approval-divider__check" aria-hidden="true">
          ✓
        </span>
        {LABELS[messageType]}
      </span>
      <div className="approval-divider__line" />
    </div>
  )
}
