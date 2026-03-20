import { describe, expect, it } from "vitest"

import { mergeStreamingMessages } from "./useThreadStreaming.js"

function fakeMsg(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    threadId: "thread_1",
    role: "coordinator" as const,
    provider: null,
    model: null,
    messageType: "text" as const,
    content: { text: "hello" },
    artifactRefs: [],
    createdAt: "2026-03-20T00:00:00Z",
    ...overrides,
  }
}

describe("mergeStreamingMessages", () => {
  it("appends a new complete message", () => {
    const existing = [fakeMsg()]
    const incoming = fakeMsg({ id: "msg_2", content: { text: "world" } })
    const result = mergeStreamingMessages(existing, incoming)
    expect(result).toHaveLength(2)
    expect(result[1].id).toBe("msg_2")
  })

  it("updates an existing partial message in place", () => {
    const existing = [fakeMsg({ content: { text: "hel" }, partial: true })]
    const incoming = fakeMsg({ content: { text: "hello wor" }, partial: true })
    const result = mergeStreamingMessages(existing, incoming)
    expect(result).toHaveLength(1)
    expect(result[0].content.text).toBe("hello wor")
    expect(result[0].partial).toBe(true)
  })

  it("finalizes a partial message when partial is absent", () => {
    const existing = [fakeMsg({ content: { text: "hello wor" }, partial: true })]
    const incoming = fakeMsg({ content: { text: "hello world" } })
    const result = mergeStreamingMessages(existing, incoming)
    expect(result).toHaveLength(1)
    expect(result[0].content.text).toBe("hello world")
    expect(result[0].partial).toBeUndefined()
  })
})
