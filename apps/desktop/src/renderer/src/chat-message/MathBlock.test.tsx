import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MathBlock } from "./MathBlock"

describe("MathBlock", () => {
  it("renders KaTeX output for valid LaTeX", () => {
    const html = renderToStaticMarkup(
      <MathBlock value="E = mc^2" displayMode={true} />
    )
    expect(html).toContain("katex")
  })

  it("renders source toggle for block math", () => {
    const html = renderToStaticMarkup(
      <MathBlock value="E = mc^2" displayMode={true} />
    )
    expect(html).toContain("View source")
  })

  it("renders inline math without toggle", () => {
    const html = renderToStaticMarkup(
      <MathBlock value="x^2" displayMode={false} />
    )
    expect(html).toContain("katex")
    expect(html).not.toContain("View source")
  })

  it("shows raw source for invalid LaTeX", () => {
    const html = renderToStaticMarkup(
      <MathBlock value="\invalid{{{" displayMode={true} />
    )
    expect(html).toContain("\\invalid{{{")
  })
})
