import { describe, expect, it } from "vitest"
import { subscriptionMethodSchema } from "./ipc.js"
import {
  parseTerminalCommandGenEvent,
  parseTerminalCommandGenInput,
  terminalCommandGenCompleteEventSchema,
  terminalCommandGenDeltaEventSchema,
  terminalCommandGenErrorEventSchema,
  terminalCommandGenInputSchema,
} from "./terminal-command-gen.js"

describe("terminalCommandGenInputSchema", () => {
  it("parses a valid input payload", () => {
    const input = {
      project_id: "proj-1",
      prompt: "list all running docker containers",
      cwd: "/Users/tony/Projects/ultra",
      recent_output: "$ docker ps\nCONTAINER ID   IMAGE\n",
      provider: "claude",
      model: "sonnet-4-6",
      session_id: "term-1",
    }

    const result = terminalCommandGenInputSchema.parse(input)

    expect(result.project_id).toBe("proj-1")
    expect(result.prompt).toBe("list all running docker containers")
    expect(result.provider).toBe("claude")
  })

  it("rejects unknown provider", () => {
    const input = {
      project_id: "proj-1",
      prompt: "test",
      cwd: "/tmp",
      recent_output: "",
      provider: "openai",
      model: "gpt-4",
      session_id: "term-1",
    }

    expect(() => terminalCommandGenInputSchema.parse(input)).toThrow()
  })

  it("rejects empty prompt", () => {
    const input = {
      project_id: "proj-1",
      prompt: "",
      cwd: "/tmp",
      recent_output: "",
      provider: "claude",
      model: "sonnet-4-6",
      session_id: "term-1",
    }

    expect(() => terminalCommandGenInputSchema.parse(input)).toThrow()
  })
})

describe("terminalCommandGenDeltaEventSchema", () => {
  it("parses a delta event", () => {
    const event = { type: "delta", text: "grep -rn" }
    const result = terminalCommandGenDeltaEventSchema.parse(event)
    expect(result.type).toBe("delta")
    expect(result.text).toBe("grep -rn")
  })
})

describe("terminalCommandGenCompleteEventSchema", () => {
  it("parses a complete event", () => {
    const event = { type: "complete", command: "grep -rn TODO ." }
    const result = terminalCommandGenCompleteEventSchema.parse(event)
    expect(result.type).toBe("complete")
    expect(result.command).toBe("grep -rn TODO .")
  })
})

describe("terminalCommandGenErrorEventSchema", () => {
  it("parses an error event", () => {
    const event = { type: "error", message: "CLI timed out" }
    const result = terminalCommandGenErrorEventSchema.parse(event)
    expect(result.type).toBe("error")
    expect(result.message).toBe("CLI timed out")
  })
})

describe("parseTerminalCommandGenEvent", () => {
  it("parses any valid event type", () => {
    expect(parseTerminalCommandGenEvent({ type: "delta", text: "ls" })).toEqual(
      {
        type: "delta",
        text: "ls",
      },
    )
    expect(
      parseTerminalCommandGenEvent({ type: "complete", command: "ls -la" }),
    ).toEqual({ type: "complete", command: "ls -la" })
    expect(
      parseTerminalCommandGenEvent({ type: "error", message: "fail" }),
    ).toEqual({ type: "error", message: "fail" })
  })
})

describe("parseTerminalCommandGenInput", () => {
  it("parses valid input", () => {
    const input = {
      project_id: "proj-1",
      prompt: "find large files",
      cwd: "/tmp",
      recent_output: "",
      provider: "codex",
      model: "gpt-5.4",
      session_id: "term-1",
    }

    const result = parseTerminalCommandGenInput(input)
    expect(result.provider).toBe("codex")
  })
})

describe("ipc subscription method includes terminal.generate_command", () => {
  it("accepts terminal.generate_command as a subscription method", () => {
    const result = subscriptionMethodSchema.parse("terminal.generate_command")
    expect(result).toBe("terminal.generate_command")
  })
})
