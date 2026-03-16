import { describe, expect, it, vi } from "vitest"

import { terminalOutputEmitter } from "./terminal-output-emitter.js"
import { subscribeToTerminalOutput } from "./terminal-subscriptions.js"

describe("subscribeToTerminalOutput", () => {
  it("subscribes to terminal.output with correct params", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      subscribe: vi.fn().mockResolvedValue(unsubscribe),
    }

    await subscribeToTerminalOutput("proj-1", "term-1", client)

    expect(client.subscribe).toHaveBeenCalledWith(
      "terminal.output",
      { project_id: "proj-1", session_id: "term-1" },
      expect.any(Function),
    )
  })

  it("routes parsed output chunks through the emitter", async () => {
    let capturedListener: ((event: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn().mockImplementation((_name, _payload, listener) => {
        capturedListener = listener
        return Promise.resolve(vi.fn())
      }),
    }

    await subscribeToTerminalOutput("proj-1", "term-1", client)

    const handler = vi.fn()
    terminalOutputEmitter.on("term-1", handler)

    // Simulate a subscription event
    capturedListener?.({
      protocol_version: "1.0",
      type: "event",
      subscription_id: "sub-1",
      event_name: "terminal.output",
      payload: {
        project_id: "proj-1",
        session_id: "term-1",
        sequence_number: 1,
        chunk: "hello world",
        occurred_at: "2026-03-14T00:00:00Z",
      },
    })

    expect(handler).toHaveBeenCalledWith("hello world")

    terminalOutputEmitter.off("term-1", handler)
  })

  it("returns the unsubscribe function from the client", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      subscribe: vi.fn().mockResolvedValue(unsubscribe),
    }

    const result = await subscribeToTerminalOutput("proj-1", "term-1", client)

    expect(result).toBe(unsubscribe)
  })
})
