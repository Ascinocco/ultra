import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CodeBlock } from "./CodeBlock"

describe("CodeBlock", () => {
  it("renders language label when provided", () => {
    const html = renderToStaticMarkup(
      <CodeBlock language="typescript" value={"const x = 1"} />
    )
    expect(html).toContain("typescript")
  })

  it("renders copy button", () => {
    const html = renderToStaticMarkup(
      <CodeBlock language="typescript" value={"const x = 1"} />
    )
    expect(html).toContain("Copy")
  })

  it("renders code content", () => {
    const html = renderToStaticMarkup(
      <CodeBlock language="" value={'console.log("hello")'} />
    )
    expect(html).toContain("console.log")
  })

  it("renders without language label when language is empty", () => {
    const html = renderToStaticMarkup(
      <CodeBlock language="" value={"some code"} />
    )
    expect(html).toContain("some code")
  })
})
