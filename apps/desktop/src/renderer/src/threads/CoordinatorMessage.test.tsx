import { describe, expect, it } from "vitest"

import { getMessageClass } from "./CoordinatorMessage.js"

function fakeMsg(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    threadId: "thread_1",
    role: "coordinator" as const,
    provider: null,
    model: null,
    messageType: "text" as const,
    content: { text: "Hello" },
    artifactRefs: [],
    createdAt: "2026-03-20T00:00:00Z",
    ...overrides,
  }
}

describe("getMessageClass", () => {
  it("returns text class for text type", () => {
    expect(getMessageClass(fakeMsg())).toContain("coord-msg--text")
  })

  it("returns status class for status type", () => {
    expect(getMessageClass(fakeMsg({ messageType: "status" }))).toContain("coord-msg--status")
  })

  it("returns blocking-question class", () => {
    expect(getMessageClass(fakeMsg({ messageType: "blocking_question" }))).toContain("coord-msg--blocking-question")
  })

  it("returns system class for system role regardless of type", () => {
    expect(getMessageClass(fakeMsg({ role: "system", messageType: "text" }))).toContain("coord-msg--system")
  })

  it("includes streaming class when partial is true", () => {
    expect(getMessageClass(fakeMsg({ partial: true }))).toContain("coord-msg--streaming")
  })

  it("does not include streaming class when partial is absent", () => {
    expect(getMessageClass(fakeMsg())).not.toContain("coord-msg--streaming")
  })
})
