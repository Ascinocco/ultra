import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TerminalDrawer } from "./TerminalDrawer.js"

function renderDrawer(props?: Partial<Parameters<typeof TerminalDrawer>[0]>) {
  return renderToStaticMarkup(
    <TerminalDrawer
      height={200}
      onResize={() => undefined}
      onClose={() => undefined}
      {...props}
    />,
  )
}

describe("TerminalDrawer", () => {
  it("renders the terminal drawer container", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer")
  })

  it("renders a drag handle", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer__drag-handle")
  })

  it("renders the header with Terminal label", () => {
    const markup = renderDrawer()

    expect(markup).toContain("Terminal")
  })

  it("renders a close button", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer__close")
  })

  it("renders the placeholder content area", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer__content")
  })

  it("applies height via inline style", () => {
    const markup = renderDrawer({ height: 300 })

    expect(markup).toContain("300px")
  })
})
