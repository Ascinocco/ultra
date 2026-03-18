import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TerminalCommandBar } from "./TerminalCommandBar.js"

const defaultProps = {
  visible: true,
  provider: "claude" as const,
  model: "claude-sonnet-4-6",
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  onProviderChange: vi.fn(),
  onModelChange: vi.fn(),
  availableProviders: ["claude", "codex"] as Array<"claude" | "codex">,
}

function renderBar(overrides?: Partial<typeof defaultProps>) {
  return renderToStaticMarkup(
    <TerminalCommandBar {...defaultProps} {...overrides} />,
  )
}

describe("TerminalCommandBar", () => {
  it("renders input when visible", () => {
    const markup = renderBar()
    expect(markup).toContain("Describe a command...")
    expect(markup).toContain("terminal-command-bar__input")
  })

  it("does not render when not visible", () => {
    const markup = renderBar({ visible: false })
    expect(markup).toBe("")
  })

  it("shows the ⌘K badge in default state", () => {
    const markup = renderBar()
    expect(markup).toContain("terminal-command-bar__badge")
  })

  it("shows generating state with spinner and label", () => {
    const markup = renderBar({ generating: true })
    expect(markup).toContain("terminal-command-bar--generating")
    expect(markup).toContain("Generating command...")
    expect(markup).toContain("terminal-command-bar__spinner")
  })

  it("shows streaming text during generation", () => {
    const markup = renderBar({ generating: true, streamingText: "grep -rn" })
    expect(markup).toContain("grep -rn")
    expect(markup).toContain("terminal-command-bar__streaming-text")
  })

  it("omits streaming text element when streamingText is empty", () => {
    const markup = renderBar({ generating: true, streamingText: "" })
    expect(markup).not.toContain("terminal-command-bar__streaming-text")
  })

  it("shows error state with error text and retry button", () => {
    const markup = renderBar({ error: "CLI timed out" })
    expect(markup).toContain("terminal-command-bar--error")
    expect(markup).toContain("CLI timed out")
    expect(markup).toContain("Retry")
  })

  it("shows the current model name", () => {
    const markup = renderBar({ model: "claude-opus-4-6" })
    expect(markup).toContain("claude-opus-4-6")
    expect(markup).toContain("terminal-command-bar__model-name")
  })

  it("shows claude provider icon when provider is claude", () => {
    const markup = renderBar({ provider: "claude" })
    expect(markup).toContain("terminal-command-bar__provider-icon--claude")
  })

  it("does not show claude provider icon when provider is codex", () => {
    const markup = renderBar({ provider: "codex" })
    expect(markup).not.toContain("terminal-command-bar__provider-icon--claude")
  })

  it("renders model picker trigger with chevron", () => {
    const markup = renderBar()
    expect(markup).toContain("terminal-command-bar__model-trigger")
    expect(markup).toContain("terminal-command-bar__chevron")
  })

  it("does not render dropdown by default (closed state)", () => {
    const markup = renderBar()
    expect(markup).not.toContain("terminal-command-bar__dropdown")
  })

  it("shows Esc kbd hint in generating state", () => {
    const markup = renderBar({ generating: true })
    expect(markup).toContain("terminal-command-bar__kbd")
    expect(markup).toContain("Esc")
  })

  it("shows Esc kbd hint in error state", () => {
    const markup = renderBar({ error: "fail" })
    expect(markup).toContain("terminal-command-bar__kbd")
    expect(markup).toContain("Esc")
  })
})
