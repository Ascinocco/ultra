import { describe, expect, it, vi } from "vitest"

import { ClaudeChatRuntimeAdapter, parseClaudeLine } from "./claude-chat-runtime-adapter.js"
import type {
  ChatRuntimeEvent,
  RuntimeProcessRunner,
  RuntimeProcessRunOptions,
  RuntimeProcessResult,
} from "./types.js"

function createRunner(
  lines: string[],
  stderr = "",
): {
  runner: RuntimeProcessRunner
  calls: Array<{ command: string; args: string[]; cwd: string }>
} {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = []

  return {
    calls,
    runner: {
      async run(options) {
        calls.push({
          command: options.command,
          args: options.args,
          cwd: options.cwd,
        })

        return {
          exitCode: 0,
          signal: null,
          stdout: `${lines.join("\n")}\n`,
          stderr,
          stdoutLines: lines,
          stderrLines: stderr ? [stderr] : [],
          timedOut: false,
        }
      },
    },
  }
}

describe("ClaudeChatRuntimeAdapter", () => {
  it("normalizes verbose stream-json output into runtime events", async () => {
    const { runner, calls } = createRunner(
      [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Working " },
          },
          session_id: "vendor_claude_1",
        }),
        JSON.stringify({
          type: "tool_use",
          tool: "edit",
          path: "src/app.ts",
          summary: "Applied edit",
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "All set",
        }),
      ],
      "claude diagnostic warning",
    )
    const adapter = new ClaudeChatRuntimeAdapter(runner)

    const result = await adapter.runTurn({
      chatId: "chat_1",
      chatSessionId: "chat_sess_1",
      cwd: "/repo",
      prompt: "Fix it",
      config: {
        provider: "claude",
        model: "sonnet",
        thinkingLevel: "medium",
        permissionLevel: "supervised",
      },
      continuationPrompt: null,
      seedMessages: [],
      vendorSessionId: null,
    })

    expect(calls[0]).toMatchObject({
      command: "claude",
      cwd: "/repo",
    })
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "auto",
        "--effort",
        "medium",
      ]),
    )
    expect(result.vendorSessionId).toBe("vendor_claude_1")
    expect(result.finalText).toBe("All set")
    expect(result.events).toEqual(
      expect.arrayContaining([
        { type: "assistant_delta", text: "Working " },
        { type: "assistant_final", text: "All set" },
        expect.objectContaining({ type: "tool_activity" }),
        expect.objectContaining({ type: "checkpoint_candidate" }),
      ]),
    )
    expect(result.diagnostics?.stderr).toContain("claude diagnostic warning")
  })

  it("uses resume mode and rejects unknown thinking levels", async () => {
    const { runner, calls } = createRunner([
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Resumed",
      }),
    ])
    const adapter = new ClaudeChatRuntimeAdapter(runner)

    await expect(
      adapter.runTurn({
        chatId: "chat_1",
        chatSessionId: "chat_sess_1",
        cwd: "/repo",
        prompt: "Continue",
        config: {
          provider: "claude",
          model: "sonnet",
          thinkingLevel: "default",
          permissionLevel: "full_access",
        },
        continuationPrompt: null,
        seedMessages: [],
        vendorSessionId: "vendor_claude_1",
      }),
    ).resolves.toMatchObject({
      finalText: "Resumed",
      resumed: true,
    })

    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "--resume",
        "vendor_claude_1",
        "--permission-mode",
        "bypassPermissions",
      ]),
    )

    await expect(
      adapter.runTurn({
        chatId: "chat_1",
        chatSessionId: "chat_sess_1",
        cwd: "/repo",
        prompt: "Continue",
        config: {
          provider: "claude",
          model: "sonnet",
          thinkingLevel: "extreme",
          permissionLevel: "supervised",
        },
        continuationPrompt: null,
        seedMessages: [],
        vendorSessionId: null,
      }),
    ).rejects.toThrow(/does not support thinking level 'extreme'/)
  })
})

// --- Streaming tests ---

function makeFakeRunner(lines: string[]): RuntimeProcessRunner {
  return {
    run: async (options: RuntimeProcessRunOptions): Promise<RuntimeProcessResult> => {
      if (options.onLine) {
        for (const line of lines) {
          options.onLine(line)
        }
      }
      return {
        exitCode: 0,
        signal: null,
        stdout: lines.join("\n"),
        stderr: "",
        stdoutLines: lines,
        stderrLines: [],
        timedOut: false,
      }
    },
  }
}

// Test data using the stream_event wrapper format
const deltaLine1 = JSON.stringify({
  type: "stream_event",
  event: { type: "content_block_delta", text: "Hello" },
})

const deltaLine2 = JSON.stringify({
  type: "stream_event",
  event: { type: "content_block_delta", text: " world" },
})

const resultLine = JSON.stringify({
  type: "stream_event",
  event: { type: "result", text: "Hello world" },
  session_id: "vendor-session-123",
})

describe("parseClaudeLine", () => {
  it("parses a delta line into an assistant_delta event", () => {
    const result = parseClaudeLine(deltaLine1)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(result.finalText).toBeUndefined()
  })

  it("parses a result line into finalText and extracts vendorSessionId", () => {
    const result = parseClaudeLine(resultLine)
    expect(result.events).toHaveLength(0)
    expect(result.finalText).toBe("Hello world")
    expect(result.vendorSessionId).toBe("vendor-session-123")
  })

  it("returns empty events for non-JSON lines", () => {
    const result = parseClaudeLine("not json at all")
    expect(result.events).toHaveLength(0)
    expect(result.vendorSessionId).toBeUndefined()
    expect(result.finalText).toBeUndefined()
  })

  it("parses a runtime_notice for typed events without text", () => {
    const line = JSON.stringify({ type: "system", subtype: "init" })
    const result = parseClaudeLine(line)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe("runtime_notice")
  })
})

describe("ClaudeChatRuntimeAdapter streaming", () => {
  const baseRequest = {
    chatId: "chat_1",
    chatSessionId: "chat_sess_1",
    cwd: "/repo",
    prompt: "hello",
    config: {
      provider: "claude" as const,
      model: "sonnet",
      thinkingLevel: "default",
      permissionLevel: "full_access" as const,
    },
    continuationPrompt: null,
    seedMessages: [],
    vendorSessionId: null,
  }

  it("emits events incrementally via onEvent and returns all events in final result", async () => {
    const lines = [deltaLine1, deltaLine2, resultLine]
    const runner = makeFakeRunner(lines)
    const adapter = new ClaudeChatRuntimeAdapter(runner)

    const emittedEvents: ChatRuntimeEvent[] = []
    const onEvent = vi.fn((event: ChatRuntimeEvent) => {
      emittedEvents.push(event)
    })

    const result = await adapter.runTurn({ ...baseRequest, onEvent })

    // onEvent should have been called for each delta
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(emittedEvents[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(emittedEvents[1]).toEqual({ type: "assistant_delta", text: " world" })

    // Final result should contain all events plus assistant_final
    expect(result.finalText).toBe("Hello world")
    expect(result.vendorSessionId).toBe("vendor-session-123")
    expect(result.events).toContainEqual({ type: "assistant_delta", text: "Hello" })
    expect(result.events).toContainEqual({ type: "assistant_delta", text: " world" })
    expect(result.events).toContainEqual({ type: "assistant_final", text: "Hello world" })
  })

  it("works correctly without onEvent (batch path)", async () => {
    const lines = [deltaLine1, deltaLine2, resultLine]
    const runner = makeFakeRunner(lines)
    const adapter = new ClaudeChatRuntimeAdapter(runner)

    const result = await adapter.runTurn({ ...baseRequest })

    expect(result.finalText).toBe("Hello world")
    expect(result.vendorSessionId).toBe("vendor-session-123")
    expect(result.events).toContainEqual({ type: "assistant_delta", text: "Hello" })
    expect(result.events).toContainEqual({ type: "assistant_delta", text: " world" })
    expect(result.events).toContainEqual({ type: "assistant_final", text: "Hello world" })
  })

  it("falls back to concatenated deltas for finalText when no result line", async () => {
    const lines = [deltaLine1, deltaLine2]
    const runner = makeFakeRunner(lines)
    const adapter = new ClaudeChatRuntimeAdapter(runner)

    const emittedEvents: ChatRuntimeEvent[] = []
    const onEvent = vi.fn((event: ChatRuntimeEvent) => {
      emittedEvents.push(event)
    })

    const result = await adapter.runTurn({ ...baseRequest, onEvent })

    expect(result.finalText).toBe("Hello world")
    expect(onEvent).toHaveBeenCalledTimes(2)
  })
})
