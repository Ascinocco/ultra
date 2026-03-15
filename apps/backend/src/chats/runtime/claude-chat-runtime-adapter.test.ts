import { describe, expect, it } from "vitest"

import { ClaudeChatRuntimeAdapter } from "./claude-chat-runtime-adapter.js"
import type { RuntimeProcessRunner } from "./types.js"

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
  it("normalizes stream-json output into runtime events", async () => {
    const { runner, calls } = createRunner(
      [
        JSON.stringify({
          type: "message.delta",
          delta: "Working ",
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
          message: "All set",
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
    expect(result.diagnostics.stderr).toContain("claude diagnostic warning")
  })

  it("uses resume mode and rejects unknown thinking levels", async () => {
    const { runner, calls } = createRunner([
      JSON.stringify({
        type: "result",
        message: "Resumed",
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
