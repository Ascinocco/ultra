import { describe, expect, it } from "vitest"

import { makeTerminalSession } from "./factories.js"

describe("makeTerminalSession", () => {
  it("creates a session with required fields and overrides", () => {
    const session = makeTerminalSession("term-1", "proj-1", "sb-1", {
      title: "Custom Shell",
    })

    expect(session.sessionId).toBe("term-1")
    expect(session.projectId).toBe("proj-1")
    expect(session.sandboxId).toBe("sb-1")
    expect(session.title).toBe("Custom Shell")
    expect(session.status).toBe("running")
    expect(session.recentOutput).toBe("")
  })
})
