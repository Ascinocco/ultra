import { describe, expect, it, vi } from "vitest"
import { OrchestrationService } from "./orchestration-service.js"
import { AgentRegistry } from "./agent-registry.js"
import type { SupervisedProcessHandle, SupervisedProcessLineListener } from "../runtime/supervised-process-adapter.js"

function createMockDeps() {
  const stdoutListeners: SupervisedProcessLineListener[] = []
  const exitListeners: Array<(event: any) => void> = []

  const mockHandle: SupervisedProcessHandle = {
    pid: 12345,
    kill: vi.fn(),
    onExit: vi.fn((listener) => { exitListeners.push(listener); return () => {} }),
    onStdoutLine: vi.fn((listener) => { stdoutListeners.push(listener); return () => {} }),
    onStderrLine: vi.fn(() => () => {}),
    writeLine: vi.fn(),
  }

  return {
    processAdapter: { spawn: vi.fn(() => mockHandle) },
    threadService: {
      appendThreadEvent: vi.fn(),
      updateThreadSnapshot: vi.fn(),
    },
    worktreeManager: {
      createWorktree: vi.fn(async () => ({
        worktreePath: "/tmp/wt",
        branchName: "ultra/thr_1/lead",
      })),
      removeWorktree: vi.fn(async () => {}),
      rollbackWorktree: vi.fn(async () => {}),
    },
    mergeResolver: {
      merge: vi.fn(async () => ({ success: true, tier: 1 })),
    },
    hooksDeployer: { deployHooks: vi.fn() },
    healthMonitor: { evaluateAll: vi.fn(() => []), start: vi.fn(), stop: vi.fn() },
    agentRegistry: new AgentRegistry(),
    overlayGenerator: { generateOverlay: vi.fn(() => "# CLAUDE.md content") },
    mockHandle,
    stdoutListeners,
    exitListeners,
  }
}

describe("OrchestrationService", () => {
  it("startThread creates worktree, deploys hooks, and spawns process", async () => {
    const deps = createMockDeps()
    const service = new OrchestrationService(deps as any)

    await service.startThread("thr_1", {
      specMarkdown: "Build a login form",
      baseBranch: "main",
      repoRoot: "/tmp/repo",
    })

    expect(deps.worktreeManager.createWorktree).toHaveBeenCalledTimes(1)
    expect(deps.hooksDeployer.deployHooks).toHaveBeenCalledTimes(1)
    expect(deps.overlayGenerator.generateOverlay).toHaveBeenCalledTimes(1)
    expect(deps.processAdapter.spawn).toHaveBeenCalledTimes(1)

    const agent = deps.agentRegistry.get("thr_1_lead")
    expect(agent).toBeDefined()
    expect(agent?.agentType).toBe("lead")
    expect(agent?.state).toBe("booting")
  })

  it("handles spawn_agent event from lead by spawning sub-agent", async () => {
    const deps = createMockDeps()
    const service = new OrchestrationService(deps as any)

    await service.startThread("thr_1", {
      specMarkdown: "Build a login form",
      baseBranch: "main",
      repoRoot: "/tmp/repo",
    })

    const line = '{"type": "spawn_agent", "agent_type": "builder", "task": "Implement form", "file_scope": ["src/form.ts"]}'
    deps.stdoutListeners[0](line)

    await new Promise((r) => setTimeout(r, 50))

    expect(deps.processAdapter.spawn).toHaveBeenCalledTimes(2)
  })

  it("rejects spawn when 8 agents active", async () => {
    const deps = createMockDeps()
    const service = new OrchestrationService(deps as any)

    for (let i = 0; i < 8; i++) {
      deps.agentRegistry.register({
        agentId: `agt_${i}`, threadId: "thr_1", agentType: "builder",
        parentAgentId: null, pid: i, worktreePath: `/tmp/${i}`,
        branchName: `b${i}`, state: "running", lastActivity: "", escalationLevel: 0,
      })
    }

    await service.startThread("thr_1", {
      specMarkdown: "test",
      baseBranch: "main",
      repoRoot: "/tmp/repo",
    })

    const line = '{"type": "spawn_agent", "agent_type": "builder", "task": "overflow", "file_scope": []}'
    deps.stdoutListeners[0](line)

    await new Promise((r) => setTimeout(r, 50))

    // Only 1 createWorktree call (from startThread), spawn_agent should be rejected
    expect(deps.worktreeManager.createWorktree).toHaveBeenCalledTimes(1)
  })

  it("terminateAgent kills process and emits failure event", async () => {
    const deps = createMockDeps()
    const service = new OrchestrationService(deps as any)

    await service.startThread("thr_1", {
      specMarkdown: "test",
      baseBranch: "main",
      repoRoot: "/tmp/repo",
    })

    await service.terminateAgent("thr_1", "thr_1_lead", "stalled too long")

    expect(deps.mockHandle.kill).toHaveBeenCalled()
    expect(deps.agentRegistry.get("thr_1_lead")?.state).toBe("terminated")
    expect(deps.threadService.appendThreadEvent).toHaveBeenCalled()
  })
})
