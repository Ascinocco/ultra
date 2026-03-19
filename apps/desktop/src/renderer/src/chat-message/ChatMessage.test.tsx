import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatMessage } from "./ChatMessage"

describe("ChatMessage", () => {
  it("renders user message with You label and plain text", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="user" content="Hello **world**" />
    )
    expect(html).toContain("You")
    expect(html).not.toContain("<strong")
    expect(html).toContain("Hello **world**")
  })

  it("renders coordinator message with Assistant label and markdown", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="coordinator" content="Hello **world**" />
    )
    expect(html).toContain("Assistant")
    expect(html).toContain("<strong")
  })

  it("renders system message with System label and plain text", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="system" content="Status update" />
    )
    expect(html).toContain("System")
    expect(html).toContain("Status update")
  })

  it("does not render empty messages", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="user" content="" />
    )
    expect(html).toBe("")
  })

  it("does not render whitespace-only messages", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="user" content="   " />
    )
    expect(html).toBe("")
  })

  it("renders copy button for coordinator messages", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="coordinator" content="Some response" />
    )
    expect(html).toContain("Copy message")
  })

  it("does not render copy button for user messages", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="user" content="Some input" />
    )
    expect(html).not.toContain("Copy message")
  })
})
