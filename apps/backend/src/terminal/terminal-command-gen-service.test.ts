import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}))

import { spawn } from "node:child_process"

import { TerminalCommandGenService } from "./terminal-command-gen-service.js"

type TestProcess = EventEmitter & {
  stdin: { end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createTestProcess(): TestProcess {
  return {
    stdin: { end: vi.fn() },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    on: EventEmitter.prototype.on,
    once: EventEmitter.prototype.once,
    emit: EventEmitter.prototype.emit,
    removeListener: EventEmitter.prototype.removeListener,
    removeAllListeners: EventEmitter.prototype.removeAllListeners,
  } as unknown as TestProcess
}

describe("TerminalCommandGenService", () => {
  let service: TerminalCommandGenService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new TerminalCommandGenService()
  })

  describe("buildPrompt", () => {
    it("constructs a prompt with cwd and recent output", () => {
      const prompt = service.buildPrompt(
        "find large files",
        "/home/user/project",
        "$ ls\nfile1.ts  file2.ts\n",
      )

      expect(prompt).toContain("find large files")
      expect(prompt).toContain("/home/user/project")
      expect(prompt).toContain("file1.ts")
      expect(prompt).toContain('{"command":')
    })

    it("omits recent output section when empty", () => {
      const prompt = service.buildPrompt("list files", "/tmp", "")

      expect(prompt).toContain("list files")
      expect(prompt).toContain("/tmp")
      expect(prompt).not.toContain("Recent terminal output")
    })
  })

  describe("buildCliArgs", () => {
    it("builds Claude CLI args with correct flags", () => {
      const args = service.buildCliArgs(
        "claude",
        "claude-sonnet-4-6",
        "test prompt",
      )

      expect(args.command).toBe("claude")
      expect(args.args).toEqual([
        "-p",
        "--output-format",
        "text",
        "--model",
        "claude-sonnet-4-6",
        "--dangerously-skip-permissions",
        "--effort",
        "medium",
        "test prompt",
      ])
    })

    it("builds Codex CLI args with correct flags", () => {
      const args = service.buildCliArgs("codex", "gpt-5.4", "test prompt")

      expect(args.command).toBe("codex")
      expect(args.args).toContain("exec")
      expect(args.args).toContain("--json")
      expect(args.args).toContain("-m")
      expect(args.args).toContain("gpt-5.4")
      expect(args.args).toContain("-s")
      expect(args.args).toContain("danger-full-access")
      expect(args.args).toContain("test prompt")
    })
  })

  describe("parseCommandFromOutput", () => {
    it("extracts command from valid JSON output", () => {
      const result = service.parseCommandFromOutput(
        '{"command": "grep -rn TODO ."}',
      )
      expect(result).toBe("grep -rn TODO .")
    })

    it("extracts command from JSON embedded in other text", () => {
      const result = service.parseCommandFromOutput(
        'Some preamble\n{"command": "ls -la"}\nSome epilogue',
      )
      expect(result).toBe("ls -la")
    })

    it("returns null for invalid JSON", () => {
      const result = service.parseCommandFromOutput("not json at all")
      expect(result).toBeNull()
    })

    it("handles escaped quotes in command value", () => {
      const result = service.parseCommandFromOutput(
        '{"command": "echo \\"hello world\\""}',
      )
      expect(result).toBe('echo "hello world"')
    })

    it("returns null for JSON without command field", () => {
      const result = service.parseCommandFromOutput('{"result": "ls -la"}')
      expect(result).toBeNull()
    })
  })

  describe("generate", () => {
    it("emits complete for valid JSON output", () => {
      const proc = createTestProcess()
      vi.mocked(spawn).mockReturnValue(proc as unknown as ChildProcess)

      const events: Array<
        { type: "delta"; text: string } | { type: "complete"; command: string } | { type: "error"; message: string }
      > = []

      service.generate(
        {
          project_id: "proj-1",
          prompt: "list files",
          cwd: "/tmp",
          recent_output: "",
          provider: "claude",
          model: "claude-sonnet-4-6",
          session_id: "term-1",
        },
        (event) => events.push(event),
      )

      proc.stdout.emit("data", Buffer.from('{"command":"ls -la"}'))
      proc.emit("close", 0, null)

      expect(events).toEqual([
        { type: "delta", text: '{"command":"ls -la"}' },
        { type: "complete", command: "ls -la" },
      ])
    })

    it("includes stderr diagnostics on non-zero exit", () => {
      const proc = createTestProcess()
      vi.mocked(spawn).mockReturnValue(proc as unknown as ChildProcess)

      const events: Array<
        { type: "delta"; text: string } | { type: "complete"; command: string } | { type: "error"; message: string }
      > = []

      service.generate(
        {
          project_id: "proj-1",
          prompt: "list files",
          cwd: "/tmp",
          recent_output: "",
          provider: "claude",
          model: "claude-sonnet-4-6",
          session_id: "term-1",
        },
        (event) => events.push(event),
      )

      proc.stderr.emit(
        "data",
        Buffer.from("error: unknown option '--permission-mode'"),
      )
      proc.emit("close", 1, null)

      expect(events).toHaveLength(1)
      const event = events[0]
      expect(event.type).toBe("error")
      if (event.type === "error") {
        expect(event.message).toContain("CLI exited with code 1")
        expect(event.message).toContain(
          "unknown option '--permission-mode'",
        )
      }
    })

    it("surfaces launch failures with command context", () => {
      const proc = createTestProcess()
      vi.mocked(spawn).mockReturnValue(proc as unknown as ChildProcess)

      const events: Array<
        { type: "delta"; text: string } | { type: "complete"; command: string } | { type: "error"; message: string }
      > = []

      service.generate(
        {
          project_id: "proj-1",
          prompt: "list files",
          cwd: "/tmp",
          recent_output: "",
          provider: "claude",
          model: "claude-sonnet-4-6",
          session_id: "term-1",
        },
        (event) => events.push(event),
      )

      proc.emit("error", new Error("spawn ENOENT"))

      expect(events).toHaveLength(1)
      const event = events[0]
      expect(event.type).toBe("error")
      if (event.type === "error") {
        expect(event.message).toContain("Failed to launch claude")
        expect(event.message).toContain("spawn ENOENT")
      }
    })
  })
})
