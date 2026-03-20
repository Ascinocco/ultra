import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ApprovalDivider } from "./ApprovalDivider.js"

describe("ApprovalDivider", () => {
  it("renders 'Plan approved' for plan_approval", () => {
    const html = renderToStaticMarkup(
      <ApprovalDivider messageType="plan_approval" />,
    )
    expect(html).toContain("Plan approved")
  })

  it("renders 'Specs approved' for spec_approval", () => {
    const html = renderToStaticMarkup(
      <ApprovalDivider messageType="spec_approval" />,
    )
    expect(html).toContain("Specs approved")
  })

  it("renders 'Work started' for thread_start_request", () => {
    const html = renderToStaticMarkup(
      <ApprovalDivider messageType="thread_start_request" />,
    )
    expect(html).toContain("Work started")
  })

  it("renders with the approval-divider class", () => {
    const html = renderToStaticMarkup(
      <ApprovalDivider messageType="plan_approval" />,
    )
    expect(html).toContain("approval-divider")
  })
})
