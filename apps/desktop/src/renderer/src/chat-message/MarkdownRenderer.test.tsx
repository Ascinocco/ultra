import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MarkdownRenderer } from "./MarkdownRenderer"

describe("MarkdownRenderer", () => {
  it("renders paragraphs", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="Hello world" />)
    expect(html).toContain("<p")
    expect(html).toContain("Hello world")
  })

  it("renders bold text", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="**bold**" />)
    expect(html).toContain("<strong")
  })

  it("renders inline code with chat-inline-code class", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="`code`" />)
    expect(html).toContain("chat-inline-code")
    expect(html).not.toContain("chat-code-block")
  })

  it("renders fenced code blocks with CodeBlock component", () => {
    const md = "```typescript\nconst x = 1\n```"
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />)
    expect(html).toContain("chat-code-block")
    expect(html).toContain("typescript")
    expect(html).not.toContain("chat-inline-code")
  })

  it("renders single-line fenced code blocks as CodeBlock, not inline", () => {
    const md = "```\nfoo\n```"
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />)
    expect(html).toContain("chat-code-block")
    expect(html).not.toContain("chat-inline-code")
  })

  it("renders mermaid blocks with MermaidBlock component", () => {
    const md = "```mermaid\ngraph TD\n  A-->B\n```"
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />)
    expect(html).toContain("chat-mermaid-block")
  })

  it("renders headings", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="## Heading" />)
    expect(html).toContain("<h2")
  })

  it("renders unordered lists", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="- item one\n- item two" />)
    expect(html).toContain("<ul")
    expect(html).toContain("<li")
  })

  it("renders tables via GFM", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |"
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />)
    expect(html).toContain("<table")
  })

  it("renders blockquotes", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="> quote" />)
    expect(html).toContain("<blockquote")
  })

  it("renders links", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content="[link](https://example.com)" />
    )
    expect(html).toContain("https://example.com")
  })
})
