import { describe, expect, it, vi, beforeEach } from "vitest"

import { TerminalCommandGenService } from "./terminal-command-gen-service.js"

describe("TerminalCommandGenService", () => {
  let service: TerminalCommandGenService

  beforeEach(() => {
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
      const args = service.buildCliArgs("claude", "sonnet-4-6", "test prompt")

      expect(args.command).toBe("claude")
      expect(args.args).toContain("-p")
      expect(args.args).toContain("--output-format")
      expect(args.args).toContain("stream-json")
      expect(args.args).toContain("--model")
      expect(args.args).toContain("sonnet-4-6")
      expect(args.args).toContain("--permission-mode")
      expect(args.args).toContain("bypassPermissions")
      expect(args.args).toContain("--effort")
      expect(args.args).toContain("medium")
      expect(args.args).toContain("test prompt")
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
})
