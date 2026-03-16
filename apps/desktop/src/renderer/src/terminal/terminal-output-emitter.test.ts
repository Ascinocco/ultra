import { describe, expect, it, vi } from "vitest"

import { TerminalOutputEmitter } from "./terminal-output-emitter.js"

describe("TerminalOutputEmitter", () => {
  it("delivers chunks to a registered handler", () => {
    const emitter = new TerminalOutputEmitter()
    const handler = vi.fn()

    emitter.on("session-1", handler)
    emitter.emit("session-1", "hello")

    expect(handler).toHaveBeenCalledWith("hello")
  })

  it("does not deliver to handlers for other sessions", () => {
    const emitter = new TerminalOutputEmitter()
    const handler = vi.fn()

    emitter.on("session-1", handler)
    emitter.emit("session-2", "hello")

    expect(handler).not.toHaveBeenCalled()
  })

  it("stops delivering after off()", () => {
    const emitter = new TerminalOutputEmitter()
    const handler = vi.fn()

    emitter.on("session-1", handler)
    emitter.off("session-1", handler)
    emitter.emit("session-1", "hello")

    expect(handler).not.toHaveBeenCalled()
  })

  it("supports multiple handlers per session", () => {
    const emitter = new TerminalOutputEmitter()
    const h1 = vi.fn()
    const h2 = vi.fn()

    emitter.on("session-1", h1)
    emitter.on("session-1", h2)
    emitter.emit("session-1", "data")

    expect(h1).toHaveBeenCalledWith("data")
    expect(h2).toHaveBeenCalledWith("data")
  })

  it("off() for unknown session does not throw", () => {
    const emitter = new TerminalOutputEmitter()
    expect(() => emitter.off("nope", vi.fn())).not.toThrow()
  })
})
