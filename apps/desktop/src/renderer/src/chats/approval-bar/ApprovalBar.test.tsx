import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ApprovalBar } from "./ApprovalBar.js"

describe("ApprovalBar", () => {
  const noop = vi.fn()

  it("renders 'Approve Plan' button at step 'plan'", () => {
    const html = renderToStaticMarkup(
      <ApprovalBar
        step="plan"
        threadTitle={null}
        onApprovePlan={noop}
        onApproveSpecs={noop}
        onStartWork={noop}
      />,
    )
    expect(html).toContain("Approve Plan")
  })

  it("renders 'Approve Specs' button at step 'specs'", () => {
    const html = renderToStaticMarkup(
      <ApprovalBar
        step="specs"
        threadTitle={null}
        onApprovePlan={noop}
        onApproveSpecs={noop}
        onStartWork={noop}
      />,
    )
    expect(html).toContain("Approve Specs")
  })

  it("renders 'Start Work' button at step 'start'", () => {
    const html = renderToStaticMarkup(
      <ApprovalBar
        step="start"
        threadTitle={null}
        onApprovePlan={noop}
        onApproveSpecs={noop}
        onStartWork={noop}
      />,
    )
    expect(html).toContain("Start Work")
  })

  it("renders collapsed 'Thread started' at step 'complete'", () => {
    const html = renderToStaticMarkup(
      <ApprovalBar
        step="complete"
        threadTitle="auth-system"
        onApprovePlan={noop}
        onApproveSpecs={noop}
        onStartWork={noop}
      />,
    )
    expect(html).toContain("Thread started")
    expect(html).toContain("auth-system")
  })

  it("shows checkmark for completed steps", () => {
    const html = renderToStaticMarkup(
      <ApprovalBar
        step="start"
        threadTitle={null}
        onApprovePlan={noop}
        onApproveSpecs={noop}
        onStartWork={noop}
      />,
    )
    expect(html).toContain("approval-bar__step--done")
  })
})
