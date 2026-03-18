import { describe, expect, it, vi } from "vitest"

import {
  generateCommand,
  injectCommand,
} from "./terminal-command-gen-workflows.js"

describe("generateCommand", () => {
  it("subscribes to terminal.generate_command with correct payload", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(unsubscribe),
    }
    const listener = vi.fn()

    const unsub = await generateCommand(
      {
        projectId: "proj-1",
        prompt: "list files",
        cwd: "/tmp",
        recentOutput: "",
        provider: "claude",
        model: "claude-sonnet-4-6",
        sessionId: "term-1",
      },
      listener,
      client,
    )

    expect(client.subscribe).toHaveBeenCalledWith(
      "terminal.generate_command",
      {
        project_id: "proj-1",
        prompt: "list files",
        cwd: "/tmp",
        recent_output: "",
        provider: "claude",
        model: "claude-sonnet-4-6",
        session_id: "term-1",
      },
      expect.any(Function),
    )

    expect(unsub).toBe(unsubscribe)
  })

  it("passes codex provider/model payload through unchanged", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(unsubscribe),
    }
    const listener = vi.fn()

    await generateCommand(
      {
        projectId: "proj-1",
        prompt: "list files",
        cwd: "/tmp",
        recentOutput: "",
        provider: "codex",
        model: "gpt-5.4",
        sessionId: "term-1",
      },
      listener,
      client,
    )

    expect(client.subscribe).toHaveBeenCalledWith(
      "terminal.generate_command",
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.4",
      }),
      expect.any(Function),
    )
  })
})

describe("injectCommand", () => {
  it("delegates to writeTerminalInput", async () => {
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await injectCommand("proj-1", "term-1", "ls -la", client)

    expect(client.command).toHaveBeenCalledWith("terminal.write_input", {
      project_id: "proj-1",
      session_id: "term-1",
      input: "ls -la",
    })
  })
})
