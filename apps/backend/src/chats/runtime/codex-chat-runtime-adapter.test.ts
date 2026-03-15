import { describe, expect, it } from "vitest"

import { CodexChatRuntimeAdapter } from "./codex-chat-runtime-adapter.js"
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
