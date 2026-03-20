import { describe, expect, it } from "vitest"
import { AgentRegistry } from "./agent-registry.js"

describe("AgentRegistry", () => {
  it("registers an agent and retrieves it", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1",
      threadId: "thr_1",
      agentType: "lead",
      parentAgentId: null,
      pid: 1234,
      worktreePath: "/tmp/wt",
      branchName: "ultra/thr_1/lead",
      state: "booting",
      lastActivity: "2026-03-19T00:00:00Z",
      escalationLevel: 0,
    })

    const agent = registry.get("agt_1")
    expect(agent?.agentType).toBe("lead")
    expect(agent?.state).toBe("booting")
  })

  it("transitions state forward", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1",
      threadId: "thr_1",
      agentType: "builder",
      parentAgentId: "agt_0",
      pid: 5678,
      worktreePath: "/tmp/wt",
      branchName: "ultra/thr_1/builder-agt_1",
      state: "booting",
      lastActivity: "2026-03-19T00:00:00Z",
      escalationLevel: 0,
    })

    registry.transition("agt_1", "running")
    expect(registry.get("agt_1")?.state).toBe("running")
  })

  it("counts active agents per thread", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1", threadId: "thr_1", agentType: "builder",
      parentAgentId: null, pid: 1, worktreePath: "/tmp/1",
      branchName: "b1", state: "running", lastActivity: "", escalationLevel: 0,
    })
    registry.register({
      agentId: "agt_2", threadId: "thr_1", agentType: "builder",
      parentAgentId: null, pid: 2, worktreePath: "/tmp/2",
      branchName: "b2", state: "completed", lastActivity: "", escalationLevel: 0,
    })

    expect(registry.activeCountForThread("thr_1")).toBe(1)
  })

  it("allows stalled → running recovery", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1", threadId: "thr_1", agentType: "builder",
      parentAgentId: null, pid: 1, worktreePath: "/tmp/1",
      branchName: "b1", state: "stalled", lastActivity: "", escalationLevel: 1,
    })

    registry.transition("agt_1", "running")
    expect(registry.get("agt_1")?.state).toBe("running")
  })
})
