import { describe, expect, it } from "vitest"

import { ChatRuntimeSessionManager } from "./runtime-session-manager.js"

describe("ChatRuntimeSessionManager", () => {
  it("stores and reuses sessions for matching config", () => {
    const manager = new ChatRuntimeSessionManager()

    manager.saveSession({
      chatId: "chat_1",
      chatSessionId: "chat_sess_1",
      provider: "codex",
      model: "gpt-5.4",
      thinkingLevel: "default",
      permissionLevel: "supervised",
      cwd: "/repo",
      vendorSessionId: "vendor_1",
      lastActivityAt: "2026-03-15T12:00:00Z",
    })

    expect(
      manager.getSession(
        "chat_1",
        "chat_sess_1",
        {
          provider: "codex",
          model: "gpt-5.4",
          thinkingLevel: "default",
          permissionLevel: "supervised",
        },
        "/repo",
      ),
    ).toMatchObject({
      vendorSessionId: "vendor_1",
    })
  })

  it("invalidates sessions when config changes", () => {
    const manager = new ChatRuntimeSessionManager()

    manager.saveSession({
      chatId: "chat_1",
      chatSessionId: "chat_sess_1",
      provider: "codex",
      model: "gpt-5.4",
      thinkingLevel: "default",
      permissionLevel: "supervised",
      cwd: "/repo",
      vendorSessionId: "vendor_1",
      lastActivityAt: "2026-03-15T12:00:00Z",
    })

    expect(
      manager.getSession(
        "chat_1",
        "chat_sess_1",
        {
          provider: "codex",
          model: "gpt-5.4",
          thinkingLevel: "high",
          permissionLevel: "supervised",
        },
        "/repo",
      ),
    ).toBeNull()
    expect(manager.size()).toBe(0)
  })

  it("can invalidate and dispose sessions", () => {
    const manager = new ChatRuntimeSessionManager()

    manager.saveSession({
      chatId: "chat_1",
      chatSessionId: "chat_sess_1",
      provider: "codex",
      model: "gpt-5.4",
      thinkingLevel: "default",
      permissionLevel: "supervised",
      cwd: "/repo",
      vendorSessionId: "vendor_1",
      lastActivityAt: "2026-03-15T12:00:00Z",
    })
    manager.saveSession({
      chatId: "chat_1",
      chatSessionId: "chat_sess_2",
      provider: "codex",
      model: "gpt-5.4",
      thinkingLevel: "default",
      permissionLevel: "supervised",
      cwd: "/repo",
      vendorSessionId: "vendor_2",
      lastActivityAt: "2026-03-15T12:10:00Z",
    })

    manager.invalidate("chat_1", "chat_sess_1")
    expect(manager.size()).toBe(1)

    manager.disposeChat("chat_1")
    expect(manager.size()).toBe(0)
  })
})
