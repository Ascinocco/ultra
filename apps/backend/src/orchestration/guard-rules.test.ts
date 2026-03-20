import { describe, expect, it } from "vitest"
import {
  BLOCKED_NATIVE_TOOLS,
  BLOCKED_INTERACTIVE_TOOLS,
  WRITE_TOOLS,
  DANGEROUS_BASH_PATTERNS,
  SAFE_BASH_PREFIXES,
} from "./guard-rules.js"

describe("guard-rules", () => {
  it("blocks Agent tool for all agents", () => {
    expect(BLOCKED_NATIVE_TOOLS).toContain("Agent")
  })

  it("blocks AskUserQuestion for all agents", () => {
    expect(BLOCKED_INTERACTIVE_TOOLS).toContain("AskUserQuestion")
  })

  it("blocks Write for read-only agents", () => {
    expect(WRITE_TOOLS).toContain("Write")
    expect(WRITE_TOOLS).toContain("Edit")
    expect(WRITE_TOOLS).toContain("NotebookEdit")
  })

  it("blocks git push in dangerous patterns", () => {
    expect(DANGEROUS_BASH_PATTERNS.some((p) => p.includes("git\\s+push"))).toBe(true)
  })

  it("allows git status in safe prefixes", () => {
    expect(SAFE_BASH_PREFIXES).toContain("git status")
  })
})
