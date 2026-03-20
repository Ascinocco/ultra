import { describe, expect, it } from "vitest"
import {
  OrchestrationError,
  WorktreeError,
  MergeError,
  AgentError,
} from "./orchestration-errors.js"

describe("orchestration errors", () => {
  it("WorktreeError has correct name, code, and context", () => {
    const err = new WorktreeError("failed to create", {
      worktreePath: "/tmp/wt",
      branchName: "ultra/thr_1/lead",
    })
    expect(err.name).toBe("WorktreeError")
    expect(err.code).toBe("worktree_error")
    expect(err.worktreePath).toBe("/tmp/wt")
    expect(err.branchName).toBe("ultra/thr_1/lead")
    expect(err).toBeInstanceOf(OrchestrationError)
    expect(err).toBeInstanceOf(Error)
  })

  it("MergeError includes conflict files and tier", () => {
    const err = new MergeError("conflicts found", {
      branchName: "b1",
      conflictFiles: ["src/a.ts", "src/b.ts"],
      tier: 2,
    })
    expect(err.name).toBe("MergeError")
    expect(err.conflictFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(err.tier).toBe(2)
  })

  it("AgentError includes agent context", () => {
    const err = new AgentError("stalled", { agentId: "agt_1", agentType: "builder" })
    expect(err.name).toBe("AgentError")
    expect(err.agentId).toBe("agt_1")
    expect(err.agentType).toBe("builder")
  })

  it("preserves cause chain", () => {
    const cause = new Error("git failed")
    const err = new WorktreeError("worktree failed", { cause })
    expect(err.cause).toBe(cause)
  })
})
