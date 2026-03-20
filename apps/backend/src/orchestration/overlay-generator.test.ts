import { describe, expect, it } from "vitest"
import { generateOverlay } from "./overlay-generator.js"

describe("overlay-generator", () => {
  it("generates CLAUDE.md with base definition and task overlay", () => {
    const result = generateOverlay({
      agentType: "builder",
      agentId: "agt_123",
      threadId: "thr_456",
      branchName: "ultra/thr_456/builder-agt_123",
      worktreePath: "/tmp/worktree",
      taskDescription: "Implement the login form",
      fileScope: ["src/components/login.tsx"],
      parentAgentId: "agt_lead",
      qualityGates: [{ name: "tests", command: "pnpm test" }],
    })

    expect(result).toContain("builder")
    expect(result).toContain("agt_123")
    expect(result).toContain("ultra/thr_456/builder-agt_123")
    expect(result).toContain("Implement the login form")
    expect(result).toContain("src/components/login.tsx")
    expect(result).toContain("pnpm test")
  })

  it("includes NDJSON protocol reference", () => {
    const result = generateOverlay({
      agentType: "lead",
      agentId: "lead",
      threadId: "thr_789",
      branchName: "ultra/thr_789/lead",
      worktreePath: "/tmp/lead-wt",
      taskDescription: "Coordinate the implementation",
      fileScope: [],
      parentAgentId: null,
      qualityGates: [],
    })

    expect(result).toContain("spawn_agent")
    expect(result).toContain("agent_done")
  })

  it("includes spawn instructions only for lead agents", () => {
    const leadResult = generateOverlay({
      agentType: "lead",
      agentId: "lead",
      threadId: "thr_1",
      branchName: "ultra/thr_1/lead",
      worktreePath: "/tmp/wt",
      taskDescription: "Coordinate",
      fileScope: [],
      parentAgentId: null,
      qualityGates: [],
    })

    const builderResult = generateOverlay({
      agentType: "builder",
      agentId: "agt_1",
      threadId: "thr_1",
      branchName: "ultra/thr_1/builder-agt_1",
      worktreePath: "/tmp/wt",
      taskDescription: "Build",
      fileScope: [],
      parentAgentId: "lead",
      qualityGates: [],
    })

    expect(leadResult).toContain("Spawning Sub-Agents")
    expect(builderResult).not.toContain("Spawning Sub-Agents")
  })
})
