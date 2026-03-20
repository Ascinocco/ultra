import { PassThrough } from "node:stream"
import type { ChildProcess, SpawnOptions } from "node:child_process"
import { EventEmitter } from "node:events"

import { afterEach, describe, expect, it, vi } from "vitest"

import { CodexChatRuntimeAdapter } from "./codex-chat-runtime-adapter.js"
import type { ChatRuntimeEvent, ChatRuntimeTurnRequest } from "./types.js"
import { ChatRuntimeError } from "./types.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fake ChildProcess whose stdout/stdin are PassThrough streams
 * we control from the test side.
 *
 * - `serverWrite(obj)` pushes a JSON-RPC message into the adapter (via stdout)
 * - `capturedWrites` collects every JSON-RPC message the adapter sends (via stdin)
 * - The helper auto-responds to the handshake sequence (initialize, thread/start)
 *   and injects a `thread/started` notification with a configurable threadId.
 */
function createFakeProcess(options?: {
  threadId?: string
  autoHandshake?: boolean
}) {
  const threadId = options?.threadId ?? "thread-001"
  const autoHandshake = options?.autoHandshake ?? true

  const stdout = new PassThrough() // adapter reads from this
  const stdin = new PassThrough() // adapter writes to this
  const emitter = new EventEmitter()

  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr: new PassThrough(),
    pid: 12345,
    connected: true,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true
      return true
    }),
    ref: vi.fn(),
    unref: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }) as unknown as ChildProcess & { killed: boolean }

  const capturedWrites: any[] = []
  let lineBuffer = ""

  stdin.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString()
    const lines = lineBuffer.split("\n")
    lineBuffer = lines.pop()! // keep incomplete line in buffer
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        capturedWrites.push(parsed)

        if (autoHandshake) {
          handleAutoResponse(parsed)
        }
      } catch {
        // ignore non-JSON
      }
    }
  })

  function handleAutoResponse(msg: any) {
    // Response to a request (has id and method)
    if (msg.id != null && msg.method) {
      if (msg.method === "initialize") {
        serverWrite({ id: msg.id, result: { serverInfo: { name: "codex-app-server" } } })
      } else if (msg.method === "thread/start" || msg.method === "thread/resume") {
        serverWrite({ id: msg.id, result: {} })
        // Also send thread/started notification
        serverWrite({ method: "thread/started", params: { thread: { id: threadId } } })
      } else if (msg.method === "turn/start") {
        serverWrite({ id: msg.id, result: { turn: { id: "turn-001" } } })
      }
    }
  }

  function serverWrite(obj: Record<string, unknown>) {
    stdout.write(JSON.stringify(obj) + "\n")
  }

  function simulateExit(code = 0) {
    emitter.emit("exit", code, null)
  }

  const spawnFn = vi.fn(
    (_command: string, _args: string[], _options: SpawnOptions) => child,
  )

  return { child, spawnFn, serverWrite, capturedWrites, simulateExit }
}

function makeRequest(overrides?: Partial<ChatRuntimeTurnRequest>): ChatRuntimeTurnRequest {
  return {
    chatId: "chat_1" as any,
    chatSessionId: "sess_1",
    cwd: "/repo",
    prompt: "Hello",
    config: {
      provider: "codex",
      model: "o4-mini",
      thinkingLevel: "default",
      permissionLevel: "supervised",
    },
    continuationPrompt: null,
    seedMessages: [],
    vendorSessionId: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodexChatRuntimeAdapter (app-server JSON-RPC)", () => {
  let adapter: CodexChatRuntimeAdapter

  afterEach(() => {
    adapter?.shutdown()
  })

  it("streams text deltas via onEvent", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const events: ChatRuntimeEvent[] = []

    const resultPromise = adapter.runTurn({
      ...makeRequest(),
      onEvent: (e) => events.push(e),
    })

    // Wait a tick for the handshake + turn/start to complete, then stream
    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Hello" } })
    serverWrite({ method: "item/agentMessage/delta", params: { delta: " world" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    const result = await resultPromise

    const deltas = events.filter((e) => e.type === "assistant_delta")
    expect(deltas).toHaveLength(2)
    expect(deltas[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(deltas[1]).toEqual({ type: "assistant_delta", text: " world" })
    expect(result.finalText).toBe("Hello world")
  })

  it("works without onEvent (batch path)", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(makeRequest())

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Batch" } })
    serverWrite({ method: "item/agentMessage/delta", params: { delta: " result" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    const result = await resultPromise

    expect(result.finalText).toBe("Batch result")
    expect(result.events.some((e) => e.type === "assistant_delta")).toBe(true)
    expect(result.events.some((e) => e.type === "assistant_final")).toBe(true)
  })

  it("resolves turn with correct finalText on turn/completed", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(makeRequest())

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "The answer is 42" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    const result = await resultPromise

    expect(result.finalText).toBe("The answer is 42")
    const finals = result.events.filter((e) => e.type === "assistant_final")
    expect(finals).toHaveLength(1)
    expect(finals[0]).toEqual({ type: "assistant_final", text: "The answer is 42" })
  })

  it("auto-approves approval requests from the server", async () => {
    const { spawnFn, serverWrite, capturedWrites } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(makeRequest())

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Done" } })
    // Server sends a request (has id + method) for approval
    serverWrite({ id: "approval-1", method: "approval/requested", params: { tool: "bash", command: "rm -rf /tmp/x" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    await resultPromise

    // Find the adapter's response to the approval request
    const approvalResponse = capturedWrites.find(
      (msg) => msg.id === "approval-1" && msg.result,
    )
    expect(approvalResponse).toBeDefined()
    expect(approvalResponse.result).toEqual({ decision: "approved" })
  })

  it("maps item/started and item/completed to tool_activity events", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const events: ChatRuntimeEvent[] = []

    const resultPromise = adapter.runTurn({
      ...makeRequest(),
      onEvent: (e) => events.push(e),
    })

    await tick()
    serverWrite({
      method: "item/started",
      params: { item: { type: "bash", id: "item-1" } },
    })
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Running" } })
    serverWrite({
      method: "item/completed",
      params: { item: { type: "bash", id: "item-1" } },
    })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    await resultPromise

    const toolEvents = events.filter((e) => e.type === "tool_activity")
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0]).toMatchObject({ type: "tool_activity", label: "bash" })
    expect(toolEvents[1]).toMatchObject({ type: "tool_activity", label: "bash" })
  })

  it("reuses the session on second runTurn (no new process spawned)", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    // First turn
    const p1 = adapter.runTurn(makeRequest())
    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "First" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })
    const r1 = await p1

    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(r1.resumed).toBe(false)

    // Second turn — same chatSessionId
    const p2 = adapter.runTurn(makeRequest())
    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Second" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })
    const r2 = await p2

    // Should NOT have spawned a second process
    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(r2.resumed).toBe(true)
    expect(r2.finalText).toBe("Second")
  })

  it("captures vendorSessionId from thread/started notification", async () => {
    const { spawnFn, serverWrite } = createFakeProcess({ threadId: "thread-xyz-999" })
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(makeRequest())

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Hi" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    const result = await resultPromise
    expect(result.vendorSessionId).toBe("thread-xyz-999")
  })

  it("handles process crash gracefully — empty response error", async () => {
    const { spawnFn, simulateExit } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(makeRequest())

    await tick()
    // Process crashes with no text emitted
    simulateExit(1)

    await expect(resultPromise).rejects.toThrow(ChatRuntimeError)
    await expect(resultPromise).rejects.toThrow(/no assistant text/)
  })

  it("handles process crash mid-stream — resolves with accumulated text", async () => {
    const { spawnFn, serverWrite, simulateExit } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(makeRequest())

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Partial output" } })
    await tick()
    // Process crashes, which resolves the turn promise via the exit handler
    simulateExit(1)

    const result = await resultPromise
    expect(result.finalText).toBe("Partial output")
  })

  it("throws empty_response error when turn completes with no text", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(makeRequest())

    await tick()
    // Turn completes with no deltas
    serverWrite({ method: "turn/completed", params: {} })

    await expect(resultPromise).rejects.toThrow(ChatRuntimeError)
    await expect(resultPromise).rejects.toThrow(/no assistant text/)
  })

  it("spawns codex with app-server arg and correct cwd", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({
      spawnFn,
      codexBinaryPath: "/usr/local/bin/codex",
    })

    const resultPromise = adapter.runTurn(makeRequest({ cwd: "/my/project" }))

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Ok" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })
    await resultPromise

    expect(spawnFn).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["app-server"],
      expect.objectContaining({ cwd: "/my/project" }),
    )
  })

  it("sends correct sandbox and approval policy based on permissionLevel", async () => {
    const { spawnFn, serverWrite, capturedWrites } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const resultPromise = adapter.runTurn(
      makeRequest({
        config: {
          provider: "codex",
          model: "o4-mini",
          thinkingLevel: "default",
          permissionLevel: "full_access",
        },
      }),
    )

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Ok" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })
    await resultPromise

    // Find the thread/start request
    const threadStartReq = capturedWrites.find((m) => m.method === "thread/start")
    expect(threadStartReq).toBeDefined()
    expect(threadStartReq.params.sandbox).toBe("danger-full-access")
    expect(threadStartReq.params.approvalPolicy).toBe("never")
  })

  it("emits runtime_error events from error notifications", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const events: ChatRuntimeEvent[] = []

    const resultPromise = adapter.runTurn({
      ...makeRequest(),
      onEvent: (e) => events.push(e),
    })

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Oops" } })
    serverWrite({
      method: "error",
      params: { error: { message: "Something went wrong" } },
    })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    await resultPromise

    const errorEvents = events.filter((e) => e.type === "runtime_error")
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0]).toEqual({
      type: "runtime_error",
      message: "Something went wrong",
    })
  })

  it("maps item/commandExecution/outputDelta to tool_activity", async () => {
    const { spawnFn, serverWrite } = createFakeProcess()
    adapter = new CodexChatRuntimeAdapter({ spawnFn })

    const events: ChatRuntimeEvent[] = []

    const resultPromise = adapter.runTurn({
      ...makeRequest(),
      onEvent: (e) => events.push(e),
    })

    await tick()
    serverWrite({ method: "item/agentMessage/delta", params: { delta: "Running cmd" } })
    serverWrite({ method: "item/commandExecution/outputDelta", params: { delta: "output line" } })
    await tick()
    serverWrite({ method: "turn/completed", params: {} })

    await resultPromise

    const toolEvents = events.filter((e) => e.type === "tool_activity")
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0]).toEqual({ type: "tool_activity", label: "command_output" })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
