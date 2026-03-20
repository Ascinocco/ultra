import { describe, expect, it, vi, beforeEach } from "vitest"
import { ClaudeChatRuntimeAdapter } from "./claude-chat-runtime-adapter.js"
import type { ChatRuntimeEvent, ChatRuntimeTurnRequest } from "./types.js"

// Helper: create a fake SDK message stream
function createFakeSdkStream(messages: any[]) {
  let index = 0
  return {
    [Symbol.asyncIterator]() { return this },
    async next() {
      if (index >= messages.length) return { done: true, value: undefined }
      return { done: false, value: messages[index++] }
    },
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    setMaxThinkingTokens: vi.fn(async () => {}),
    close: vi.fn(),
  }
}

function makeRequest(overrides?: Partial<ChatRuntimeTurnRequest>): ChatRuntimeTurnRequest {
  return {
    chatId: "chat_1" as any,
    chatSessionId: "sess_1",
    cwd: "/tmp",
    prompt: "Hello",
    config: {
      provider: "claude",
      model: "claude-sonnet-4-6",
      thinkingLevel: "default",
      permissionLevel: "full_access",
    },
    continuationPrompt: null,
    seedMessages: [],
    vendorSessionId: null,
    ...overrides,
  }
}

describe("ClaudeChatRuntimeAdapter (SDK)", () => {
  it("streams text_delta events via onEvent", async () => {
    const events: ChatRuntimeEvent[] = []
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
      { type: "result", session_id: "sdk_sess_1", message: { content: [{ type: "text", text: "Hello world" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const deltas = events.filter((e) => e.type === "assistant_delta")
    expect(deltas).toHaveLength(2)
    expect(deltas[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(deltas[1]).toEqual({ type: "assistant_delta", text: " world" })
    expect(result.finalText).toBe("Hello world")
    expect(result.vendorSessionId).toBe("sdk_sess_1")
  })

  it("works without onEvent (batch path)", async () => {
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
      { type: "result", message: { content: [{ type: "text", text: "Hi" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn(makeRequest())
    expect(result.finalText).toBe("Hi")
    expect(result.events.some((e) => e.type === "assistant_delta")).toBe(true)
  })

  it("maps tool_use blocks to tool_activity events", async () => {
    const events: ChatRuntimeEvent[] = []
    const sdkMessages = [
      { type: "content_block_start", content_block: { type: "tool_use", name: "bash", id: "tool_1" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Done" } },
      { type: "result", message: { content: [{ type: "text", text: "Done" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const toolEvents = events.filter((e) => e.type === "tool_activity")
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0]).toEqual({
      type: "tool_activity",
      label: "bash",
      metadata: { id: "tool_1" },
    })
  })

  it("handles SDK errors gracefully", async () => {
    const events: ChatRuntimeEvent[] = []
    const failingStream = {
      [Symbol.asyncIterator]() { return this },
      async next() { throw new Error("SDK connection lost") },
      interrupt: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      setMaxThinkingTokens: vi.fn(async () => {}),
      close: vi.fn(),
    }

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => failingStream as any,
    })

    const result = await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const errorEvents = events.filter((e) => e.type === "runtime_error")
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0]).toEqual({
      type: "runtime_error",
      message: "SDK connection lost",
    })
  })

  it("reuses sessions across turns", async () => {
    // Create a stream that yields different results per turn
    // The iterator stays alive between turns (manual .next() doesn't call return())
    const messages = [
      // Turn 1 messages
      { type: "content_block_delta", delta: { type: "text_delta", text: "Turn 1" } },
      { type: "result", message: { content: [{ type: "text", text: "Turn 1" }] } },
      // Turn 2 messages
      { type: "content_block_delta", delta: { type: "text_delta", text: "Turn 2" } },
      { type: "result", message: { content: [{ type: "text", text: "Turn 2" }] } },
    ]
    let index = 0
    const longLivedStream = {
      [Symbol.asyncIterator]() { return this },
      async next() {
        if (index >= messages.length) return { done: true, value: undefined }
        return { done: false, value: messages[index++] }
      },
      interrupt: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      setMaxThinkingTokens: vi.fn(async () => {}),
      close: vi.fn(),
    }

    const createQuery = vi.fn(() => longLivedStream as any)
    const adapter = new ClaudeChatRuntimeAdapter({ createQuery })

    const result1 = await adapter.runTurn(makeRequest())
    expect(result1.finalText).toBe("Turn 1")

    const result2 = await adapter.runTurn(makeRequest())
    expect(result2.finalText).toBe("Turn 2")

    // query() should only be called once (session reused, iterator stayed alive)
    expect(createQuery).toHaveBeenCalledOnce()
  })

  it("falls back to joining deltas when no explicit finalText", async () => {
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Joined " } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "text" } },
      { type: "result", message: { content: [] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn(makeRequest())
    expect(result.finalText).toBe("Joined text")
  })

  it("returns diagnostics as undefined", async () => {
    const sdkMessages = [
      { type: "result", message: { content: [{ type: "text", text: "Hi" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn(makeRequest())
    expect(result.diagnostics).toBeUndefined()
  })

  it("maps thinking_delta to runtime_notice", async () => {
    const events: ChatRuntimeEvent[] = []
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me think..." } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Answer" } },
      { type: "result", message: { content: [{ type: "text", text: "Answer" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const notices = events.filter((e) => e.type === "runtime_notice")
    expect(notices).toHaveLength(1)
    expect(notices[0]).toEqual({ type: "runtime_notice", message: "Let me think..." })
  })

  it("calls interrupt() on abort signal and returns partial events", async () => {
    const controller = new AbortController()
    const events: ChatRuntimeEvent[] = []

    // Create a stream that blocks after first message until aborted
    let index = 0
    const messages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Partial" } },
    ]
    const blockingStream = {
      [Symbol.asyncIterator]() { return this },
      async next() {
        if (index < messages.length) {
          return { done: false, value: messages[index++] }
        }
        // Block until abort — simulate long-running turn
        return new Promise(() => {}) // never resolves
      },
      interrupt: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      setMaxThinkingTokens: vi.fn(async () => {}),
      close: vi.fn(),
    }

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => blockingStream as any,
    })

    // Start the turn and abort after a tick
    const turnPromise = adapter.runTurn({
      ...makeRequest(),
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    })
    // Let the first message be consumed, then abort
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()

    const result = await turnPromise
    expect(blockingStream.interrupt).toHaveBeenCalled()
    expect(events.some((e) => e.type === "assistant_delta")).toBe(true)
  })

  it("destroys session on error and recreates on next turn", async () => {
    const callCount = { value: 0 }
    const createQuery = vi.fn(() => {
      callCount.value++
      if (callCount.value === 1) {
        // First call: stream that throws
        return {
          [Symbol.asyncIterator]() { return this },
          async next() { throw new Error("SDK crash") },
          interrupt: vi.fn(async () => {}),
          setModel: vi.fn(async () => {}),
          setPermissionMode: vi.fn(async () => {}),
          setMaxThinkingTokens: vi.fn(async () => {}),
          close: vi.fn(),
        } as any
      }
      // Second call: working stream
      return createFakeSdkStream([
        { type: "content_block_delta", delta: { type: "text_delta", text: "Recovered" } },
        { type: "result", message: { content: [{ type: "text", text: "Recovered" }] } },
      ])
    })

    const adapter = new ClaudeChatRuntimeAdapter({ createQuery })

    // First turn: error
    const result1 = await adapter.runTurn(makeRequest())
    expect(result1.events.some((e) => e.type === "runtime_error")).toBe(true)

    // Second turn: should create new session (createQuery called again)
    const result2 = await adapter.runTurn(makeRequest())
    expect(result2.finalText).toBe("Recovered")
    expect(createQuery).toHaveBeenCalledTimes(2)
  })
})
