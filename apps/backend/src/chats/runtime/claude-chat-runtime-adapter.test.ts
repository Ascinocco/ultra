import { describe, expect, it, vi } from "vitest"
import { ClaudeChatRuntimeAdapter } from "./claude-chat-runtime-adapter.js"
import type { ChatRuntimeEvent, ChatRuntimeTurnRequest } from "./types.js"

/**
 * Create a fake query() function that returns an async iterable yielding the given messages.
 * The messages should be SDKMessage-shaped objects (stream_event wrappers, assistant, result, etc.)
 */
function fakeQueryFn(messages: any[]) {
  return vi.fn((_params: any) => {
    let index = 0
    return {
      [Symbol.asyncIterator]() {
        return this
      },
      async next() {
        if (index >= messages.length) return { done: true, value: undefined }
        return { done: false, value: messages[index++] }
      },
      return() {
        return Promise.resolve({ done: true, value: undefined })
      },
    } as any
  })
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
      thinkingLevel: "normal",
      permissionLevel: "full_access",
    },
    continuationPrompt: null,
    seedMessages: [],
    vendorSessionId: null,
    ...overrides,
  }
}

describe("ClaudeChatRuntimeAdapter (SDK query)", () => {
  it("streams text_delta events via onEvent from stream_event wrapper", async () => {
    const events: ChatRuntimeEvent[] = []
    const queryFn = fakeQueryFn([
      { type: "system", subtype: "init", session_id: "sdk_sess_1" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: " world" } } },
      { type: "result", session_id: "sdk_sess_1", message: { content: [{ type: "text", text: "Hello world" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    const result = await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const deltas = events.filter((e) => e.type === "assistant_delta")
    expect(deltas.length).toBeGreaterThanOrEqual(2)
    expect(deltas[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(deltas[1]).toEqual({ type: "assistant_delta", text: " world" })
    expect(result.finalText).toBe("Hello world")
    expect(result.vendorSessionId).toBe("sdk_sess_1")
  })

  it("works without onEvent (batch path)", async () => {
    const queryFn = fakeQueryFn([
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } },
      { type: "result", message: { content: [{ type: "text", text: "Hi" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    const result = await adapter.runTurn(makeRequest())

    expect(result.finalText).toBe("Hi")
    expect(result.events.some((e) => e.type === "assistant_delta")).toBe(true)
  })

  it("maps tool_use blocks to tool_activity events via stream_event", async () => {
    const events: ChatRuntimeEvent[] = []
    const queryFn = fakeQueryFn([
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "bash", id: "tool_1" } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Done" } } },
      { type: "result", message: { content: [{ type: "text", text: "Done" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
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

  it("handles errors gracefully", async () => {
    const events: ChatRuntimeEvent[] = []
    const queryFn = vi.fn(() => {
      let called = false
      return {
        [Symbol.asyncIterator]() { return this },
        async next() {
          if (!called) {
            called = true
            throw new Error("SDK connection lost")
          }
          return { done: true, value: undefined }
        },
        return() { return Promise.resolve({ done: true, value: undefined }) },
      } as any
    })

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
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

  it("falls back to joining deltas when no explicit finalText in result", async () => {
    const queryFn = fakeQueryFn([
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Joined " } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "text" } } },
      { type: "result", message: { content: [] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    const result = await adapter.runTurn(makeRequest())

    expect(result.finalText).toBe("Joined text")
  })

  it("returns diagnostics as undefined", async () => {
    const queryFn = fakeQueryFn([
      { type: "result", message: { content: [{ type: "text", text: "Hi" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    const result = await adapter.runTurn(makeRequest())

    expect(result.diagnostics).toBeUndefined()
  })

  it("maps thinking_delta to runtime_notice", async () => {
    const events: ChatRuntimeEvent[] = []
    const queryFn = fakeQueryFn([
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me think..." } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Answer" } } },
      { type: "result", message: { content: [{ type: "text", text: "Answer" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const notices = events.filter((e) => e.type === "runtime_notice")
    expect(notices).toHaveLength(1)
    expect(notices[0]).toEqual({ type: "runtime_notice", message: "Let me think..." })
  })

  it("extracts session_id from system init message", async () => {
    const queryFn = fakeQueryFn([
      { type: "system", subtype: "init", session_id: "my-session-123" },
      { type: "result", message: { content: [{ type: "text", text: "Hi" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    const result = await adapter.runTurn(makeRequest())

    expect(result.vendorSessionId).toBe("my-session-123")
  })

  it("passes resume option when vendorSessionId is provided", async () => {
    const queryFn = fakeQueryFn([
      { type: "result", message: { content: [{ type: "text", text: "Resumed" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    await adapter.runTurn(makeRequest({ vendorSessionId: "prev-session-id" }))

    expect(queryFn).toHaveBeenCalledOnce()
    const callArgs = queryFn.mock.calls[0][0]
    expect(callArgs.options.resume).toBe("prev-session-id")
    expect(callArgs.prompt).toBe("Hello")
  })

  it("extracts text from complete assistant messages", async () => {
    const events: ChatRuntimeEvent[] = []
    const queryFn = fakeQueryFn([
      { type: "assistant", message: { content: [{ type: "text", text: "Full message text" }] } },
      { type: "result", message: { content: [{ type: "text", text: "Full message text" }] } },
    ])

    const adapter = new ClaudeChatRuntimeAdapter({ queryFn })
    await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const deltas = events.filter((e) => e.type === "assistant_delta")
    expect(deltas.length).toBeGreaterThanOrEqual(1)
    expect(deltas[0]).toEqual({ type: "assistant_delta", text: "Full message text" })
  })
})
