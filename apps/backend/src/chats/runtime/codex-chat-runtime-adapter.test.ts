import { describe, expect, it, vi } from "vitest"

import { CodexChatRuntimeAdapter, parseCodexLine } from "./codex-chat-runtime-adapter.js"
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

describe("CodexChatRuntimeAdapter", () => {
  it("normalizes codex jsonl output into runtime events", async () => {
    const { runner, calls } = createRunner(
      [
        JSON.stringify({
          type: "session.started",
          session_id: "vendor_codex_1",
        }),
        JSON.stringify({
          type: "assistant.delta",
          delta: "Plan ",
        }),
        JSON.stringify({
          type: "tool",
          command: "git status",
          path: "src/index.ts",
          summary: "Checked git status",
        }),
        JSON.stringify({
          type: "assistant.final",
          text: "Plan complete",
        }),
      ],
      "codex diagnostic warning",
    )
    const adapter = new CodexChatRuntimeAdapter(runner)

    const result = await adapter.runTurn({
      chatId: "chat_1",
      chatSessionId: "chat_sess_1",
      cwd: "/repo",
      prompt: "Ship it",
      config: {
        provider: "codex",
        model: "gpt-5.4",
        thinkingLevel: "default",
        permissionLevel: "supervised",
      },
      continuationPrompt: null,
      seedMessages: [],
      vendorSessionId: null,
    })

    expect(calls[0]).toMatchObject({
      command: "codex",
      cwd: "/repo",
    })
    expect(calls[0]?.args).toContain("-a")
    expect(calls[0]?.args).toContain("workspace-write")
    expect(result.vendorSessionId).toBe("vendor_codex_1")
    expect(result.finalText).toBe("Plan complete")
    expect(result.events).toEqual(
      expect.arrayContaining([
        { type: "assistant_delta", text: "Plan " },
        { type: "assistant_final", text: "Plan complete" },
        expect.objectContaining({ type: "tool_activity" }),
        expect.objectContaining({ type: "checkpoint_candidate" }),
      ]),
    )
    expect(result.diagnostics.stderr).toContain("codex diagnostic warning")
  })

  it("uses resume mode and rejects unsupported thinking levels", async () => {
    const { runner, calls } = createRunner([
      JSON.stringify({
        type: "assistant.final",
        text: "Resumed",
      }),
    ])
    const adapter = new CodexChatRuntimeAdapter(runner)

    await expect(
      adapter.runTurn({
        chatId: "chat_1",
        chatSessionId: "chat_sess_1",
        cwd: "/repo",
        prompt: "Continue",
        config: {
          provider: "codex",
          model: "gpt-5.4",
          thinkingLevel: "default",
          permissionLevel: "full_access",
        },
        continuationPrompt: null,
        seedMessages: [],
        vendorSessionId: "vendor_codex_1",
      }),
    ).resolves.toMatchObject({
      finalText: "Resumed",
      resumed: true,
    })

    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "resume",
        "vendor_codex_1",
        "-s",
        "danger-full-access",
      ]),
    )
    expect(calls[0]?.args.at(-1)).toBe("Continue")

    await expect(
      adapter.runTurn({
        chatId: "chat_1",
        chatSessionId: "chat_sess_1",
        cwd: "/repo",
        prompt: "Continue",
        config: {
          provider: "codex",
          model: "gpt-5.4",
          thinkingLevel: "high",
          permissionLevel: "supervised",
        },
        continuationPrompt: null,
        seedMessages: [],
        vendorSessionId: null,
      }),
    ).rejects.toThrow(/does not support thinking level 'high'/)
  })
})

// --- Unit tests for parseCodexLine ---

describe("parseCodexLine", () => {
  it("parses a delta line into an assistant_delta event", () => {
    const line = JSON.stringify({ type: "assistant.delta", delta: "Hello" })
    const result = parseCodexLine(line)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(result.finalText).toBeUndefined()
  })

  it("parses a non-delta text line into finalText", () => {
    const line = JSON.stringify({
      type: "assistant.final",
      text: "Hello world",
      session_id: "vendor-session-123",
    })
    const result = parseCodexLine(line)
    expect(result.events).toHaveLength(0)
    expect(result.finalText).toBe("Hello world")
    expect(result.vendorSessionId).toBe("vendor-session-123")
  })

  it("returns empty events for non-JSON lines", () => {
    const result = parseCodexLine("not json at all")
    expect(result.events).toHaveLength(0)
    expect(result.vendorSessionId).toBeUndefined()
    expect(result.finalText).toBeUndefined()
  })

  it("parses a runtime_notice for typed events without text", () => {
    const line = JSON.stringify({ type: "session.started" })
    const result = parseCodexLine(line)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe("runtime_notice")
  })

  it("extracts vendorSessionId from any line", () => {
    const line = JSON.stringify({
      type: "assistant.delta",
      delta: "Hi",
      session_id: "vendor-abc",
    })
    const result = parseCodexLine(line)
    expect(result.vendorSessionId).toBe("vendor-abc")
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

// Test data using Codex JSON line format
const deltaLine1 = JSON.stringify({ type: "assistant.delta", delta: "Hello" })
const deltaLine2 = JSON.stringify({ type: "assistant.delta", delta: " world" })
const resultLine = JSON.stringify({
  type: "assistant.final",
  text: "Hello world",
  session_id: "vendor-session-123",
})

describe("CodexChatRuntimeAdapter streaming", () => {
  const baseRequest = {
    chatId: "chat_1",
    chatSessionId: "chat_sess_1",
    cwd: "/repo",
    prompt: "hello",
    config: {
      provider: "codex" as const,
      model: "gpt-5.4",
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
    const adapter = new CodexChatRuntimeAdapter(runner)

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
    const adapter = new CodexChatRuntimeAdapter(runner)

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
    const adapter = new CodexChatRuntimeAdapter(runner)

    const emittedEvents: ChatRuntimeEvent[] = []
    const onEvent = vi.fn((event: ChatRuntimeEvent) => {
      emittedEvents.push(event)
    })

    const result = await adapter.runTurn({ ...baseRequest, onEvent })

    expect(result.finalText).toBe("Hello world")
    expect(onEvent).toHaveBeenCalledTimes(2)
  })
})
