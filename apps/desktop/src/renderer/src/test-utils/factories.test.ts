import { describe, expect, it, test } from "vitest"

import {
  makeTerminalSession,
  makeThread,
  makeThreadMessage,
} from "./factories.js"

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
    expect(session.displayName).toBeNull()
    expect(session.pinned).toBe(false)
  })
})

describe("thread factories", () => {
  test("makeThread returns a valid ThreadSnapshot with defaults", () => {
    const thread = makeThread("t1", "proj_1")
    expect(thread.id).toBe("t1")
    expect(thread.projectId).toBe("proj_1")
    expect(thread.executionState).toBe("queued")
    expect(thread.reviewState).toBe("not_ready")
  })

  test("makeThread accepts overrides", () => {
    const thread = makeThread("t1", "proj_1", {
      executionState: "running",
      branchName: "feat/test",
    })
    expect(thread.executionState).toBe("running")
    expect(thread.branchName).toBe("feat/test")
  })

  test("makeThreadMessage returns a valid ThreadMessageSnapshot", () => {
    const msg = makeThreadMessage("msg_1", "t1")
    expect(msg.id).toBe("msg_1")
    expect(msg.threadId).toBe("t1")
    expect(msg.role).toBe("coordinator")
    expect(msg.content.text).toBe("Hello from coordinator")
  })
})
