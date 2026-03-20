import { describe, expect, it, vi, beforeEach } from "vitest"
import { ClaudeSessionManager } from "./claude-session-manager.js"
import type { ClaudeSessionContext, ClaudeSessionConfig } from "./claude-session-manager.js"

// Mock the SDK query function
function createMockQuery() {
  const messages: unknown[] = []
  const iterator = {
    [Symbol.asyncIterator]() { return this },
    async next() { return { done: true, value: undefined } },
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    setMaxThinkingTokens: vi.fn(async () => {}),
    close: vi.fn(),
  }
  return { iterator, messages }
}

describe("ClaudeSessionManager", () => {
  let manager: ClaudeSessionManager
  const mockCreateQuery = vi.fn()

  beforeEach(() => {
    mockCreateQuery.mockReset()
    mockCreateQuery.mockReturnValue(createMockQuery().iterator)
    manager = new ClaudeSessionManager({
      pathToClaudeCodeExecutable: "claude",
      createQuery: mockCreateQuery,
    })
  })

  it("creates a new session on first getOrCreate", () => {
    const session = manager.getOrCreate("chat_1", {
      cwd: "/tmp",
      model: "claude-sonnet-4-6",
      permissionLevel: "full_access",
    })
    expect(session).toBeDefined()
    expect(session.chatId).toBe("chat_1")
    expect(mockCreateQuery).toHaveBeenCalledOnce()
  })

  it("reuses existing session on second getOrCreate", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    const session1 = manager.getOrCreate("chat_1", config)
    const session2 = manager.getOrCreate("chat_1", config)
    expect(session1).toBe(session2)
    expect(mockCreateQuery).toHaveBeenCalledOnce()
  })

  it("creates separate sessions for different chats", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    const session1 = manager.getOrCreate("chat_1", config)
    const session2 = manager.getOrCreate("chat_2", config)
    expect(session1).not.toBe(session2)
    expect(mockCreateQuery).toHaveBeenCalledTimes(2)
  })

  it("destroy removes the session", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    const session = manager.getOrCreate("chat_1", config)
    manager.destroy("chat_1")
    // Next getOrCreate should create a new session
    const session2 = manager.getOrCreate("chat_1", config)
    expect(session2).not.toBe(session)
    expect(mockCreateQuery).toHaveBeenCalledTimes(2)
  })

  it("destroyAll removes all sessions", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    manager.getOrCreate("chat_1", config)
    manager.getOrCreate("chat_2", config)
    manager.destroyAll()
    // Both should create new sessions
    manager.getOrCreate("chat_1", config)
    manager.getOrCreate("chat_2", config)
    expect(mockCreateQuery).toHaveBeenCalledTimes(4)
  })
})
