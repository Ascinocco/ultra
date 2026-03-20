import { describe, expect, it } from "vitest"
import { AgentHealthMonitor, isProcessRunning } from "./agent-health-monitor.js"
import { AgentRegistry } from "./agent-registry.js"

describe("AgentHealthMonitor", () => {
  it("detects stalled agent when no activity", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1", threadId: "thr_1", agentType: "builder",
      parentAgentId: null, pid: 99999,
      worktreePath: "/tmp/wt", branchName: "b1",
      state: "running",
      lastActivity: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      escalationLevel: 0,
    })

    const monitor = new AgentHealthMonitor(registry, {
      staleMs: 5 * 60 * 1000,
      zombieMs: 15 * 60 * 1000,
    })

    const actions = monitor.evaluateAll()
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe("warn")
    expect(actions[0].agentId).toBe("agt_1")
  })

  it("skips completed agents", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1", threadId: "thr_1", agentType: "builder",
      parentAgentId: null, pid: 99999,
      worktreePath: "/tmp/wt", branchName: "b1",
      state: "completed",
      lastActivity: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      escalationLevel: 0,
    })

    const monitor = new AgentHealthMonitor(registry, {
      staleMs: 5 * 60 * 1000,
      zombieMs: 15 * 60 * 1000,
    })

    const actions = monitor.evaluateAll()
    expect(actions).toHaveLength(0)
  })

  it("escalates from warn to nudge on second stale detection", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1", threadId: "thr_1", agentType: "builder",
      parentAgentId: null, pid: 99999,
      worktreePath: "/tmp/wt", branchName: "b1",
      state: "stalled",
      lastActivity: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      escalationLevel: 1,
    })

    const monitor = new AgentHealthMonitor(registry, {
      staleMs: 5 * 60 * 1000,
      zombieMs: 15 * 60 * 1000,
    })

    const actions = monitor.evaluateAll()
    expect(actions[0].action).toBe("nudge")
  })

  it("exempts leads with active children from stale detection", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "lead_1", threadId: "thr_1", agentType: "lead",
      parentAgentId: null, pid: 99999,
      worktreePath: "/tmp/wt", branchName: "b1",
      state: "running",
      lastActivity: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      escalationLevel: 0,
    })
    registry.register({
      agentId: "builder_1", threadId: "thr_1", agentType: "builder",
      parentAgentId: "lead_1", pid: 99998,
      worktreePath: "/tmp/wt2", branchName: "b2",
      state: "running",
      lastActivity: new Date().toISOString(),
      escalationLevel: 0,
    })

    const monitor = new AgentHealthMonitor(registry, {
      staleMs: 5 * 60 * 1000,
      zombieMs: 15 * 60 * 1000,
    })

    const actions = monitor.evaluateAll()
    const leadAction = actions.find((a) => a.agentId === "lead_1")
    expect(leadAction).toBeUndefined()
  })

  it("terminates zombie agents past zombieMs", () => {
    const registry = new AgentRegistry()
    registry.register({
      agentId: "agt_1", threadId: "thr_1", agentType: "builder",
      parentAgentId: null, pid: 99999,
      worktreePath: "/tmp/wt", branchName: "b1",
      state: "stalled",
      lastActivity: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      escalationLevel: 2,
    })

    const monitor = new AgentHealthMonitor(registry, {
      staleMs: 5 * 60 * 1000,
      zombieMs: 15 * 60 * 1000,
    })

    const actions = monitor.evaluateAll()
    expect(actions[0].action).toBe("terminate")
  })
})

describe("isProcessRunning", () => {
  it("returns true for current process", () => {
    expect(isProcessRunning(process.pid)).toBe(true)
  })

  it("returns false for non-existent PID", () => {
    expect(isProcessRunning(999999)).toBe(false)
  })
})
