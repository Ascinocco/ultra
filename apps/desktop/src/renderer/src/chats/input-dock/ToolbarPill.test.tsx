import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ToolbarPill } from "./ToolbarPill.js"

describe("ToolbarPill", () => {
  const options = [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
  ]

  it("renders the current label", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Normal" options={options} value="normal" onChange={() => {}} />,
    )
    expect(html).toContain("Normal")
    expect(html).toContain("input-dock__pill")
  })

  it("renders with icon when provided", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Full access" icon="🛡" options={options} value="normal" onChange={() => {}} />,
    )
    expect(html).toContain("🛡")
  })

  it("renders dropdown arrow when editable", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Normal" options={options} value="normal" onChange={() => {}} />,
    )
    expect(html).toContain("input-dock__pill-arrow")
  })

  it("renders without dropdown arrow when readOnly", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Normal" options={options} value="normal" onChange={() => {}} readOnly />,
    )
    expect(html).toContain("input-dock__pill--readonly")
    expect(html).not.toContain("input-dock__pill-arrow")
  })
})
