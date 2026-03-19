import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MermaidBlock } from "./MermaidBlock"

describe("MermaidBlock", () => {
  it("renders the source code on SSR", () => {
    const html = renderToStaticMarkup(
      <MermaidBlock value={"graph TD\n  A-->B"} />
    )
    expect(html).toContain("graph TD")
  })

  it("renders mermaid label", () => {
    const html = renderToStaticMarkup(
      <MermaidBlock value={"graph TD\n  A-->B"} />
    )
    expect(html).toContain("mermaid")
  })
})
