import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import type { AgentHealthMonitor } from "./agent-health-monitor.js"
import type { AgentRegistry, AgentType } from "./agent-registry.js"
import type { MergeResult } from "./merge-resolver.js"
import type { createWorktree, removeWorktree, rollbackWorktree } from "./worktree-manager.js"
import type { deployHooks } from "./hooks-deployer.js"
import type { generateOverlay } from "./overlay-generator.js"
import { parseAgentLine } from "./ndjson-parser.js"
import {
  type SupervisedProcessAdapter,
  type SupervisedProcessHandle,
  isInteractiveSupervisedProcessHandle,
} from "../runtime/supervised-process-adapter.js"

export type OrchestrationDependencies = {
  processAdapter: SupervisedProcessAdapter
  threadService: {
    appendThreadEvent: (threadId: string, event: Record<string, unknown>) => void
    updateThreadSnapshot: (threadId: string, update: Record<string, unknown>) => void
  }
  worktreeManager: {
    createWorktree: typeof createWorktree
    removeWorktree: typeof removeWorktree
    rollbackWorktree: typeof rollbackWorktree
  }
  mergeResolver: {
    merge: (repoRoot: string, branch: string, context: { taskSummary: string }) => Promise<MergeResult>
  }
  hooksDeployer: {
    deployHooks: typeof deployHooks
  }
  healthMonitor: AgentHealthMonitor
  agentRegistry: AgentRegistry
  overlayGenerator: {
    generateOverlay: typeof generateOverlay
  }
}

type ThreadSpec = {
  specMarkdown: string
  baseBranch: string
  repoRoot: string
}

type SpawnRequest = {
  agent_type: AgentType
  task: string
  file_scope: string[]
}

const AGENT_LIMIT = 8
const WORKTREES_BASE = ".ultra/worktrees"

function randomSuffix(): string {
  return randomBytes(3).toString("hex")
}

export class OrchestrationService {
  private readonly handles = new Map<string, SupervisedProcessHandle>()
  private readonly threadRepoRoots = new Map<string, string>()

  constructor(private readonly deps: OrchestrationDependencies) {}

  async startThread(threadId: string, spec: ThreadSpec): Promise<void> {
    const { specMarkdown, baseBranch, repoRoot } = spec
    const agentId = `${threadId}_lead`
    const baseDir = join(repoRoot, WORKTREES_BASE)

    const { worktreePath, branchName } = await this.deps.worktreeManager.createWorktree({
      repoRoot,
      baseDir,
      baseBranch,
      agentType: "lead",
      agentId,
      threadId,
    })

    this.threadRepoRoots.set(threadId, repoRoot)

    const overlayContent = this.deps.overlayGenerator.generateOverlay({
      agentType: "lead",
      agentId,
      threadId,
      branchName,
      worktreePath,
      taskDescription: specMarkdown,
      fileScope: [],
      parentAgentId: null,
      qualityGates: [],
    })

    mkdirSync(worktreePath, { recursive: true })
    writeFileSync(join(worktreePath, "CLAUDE.md"), overlayContent, "utf-8")

    this.deps.hooksDeployer.deployHooks(worktreePath, {
      agentType: "lead",
      agentId,
      branchName,
    })

    const handle = this.deps.processAdapter.spawn({
      componentType: "agent",
      scope: "project",
      command: "claude",
      args: ["--dangerously-skip-permissions"],
      cwd: worktreePath,
      env: {
        ULTRA_AGENT: "true",
        ULTRA_WORKTREE_PATH: worktreePath,
        ULTRA_AGENT_ID: agentId,
        ULTRA_THREAD_ID: threadId,
      },
    })

    this.handles.set(agentId, handle)

    if (isInteractiveSupervisedProcessHandle(handle)) {
      handle.onStdoutLine((line) => {
        const result = parseAgentLine(line)
        if (result.kind === "event") {
          void this.handleAgentEvent(threadId, agentId, result.event as Record<string, unknown>)
        }
      })
    }

    handle.onExit((exitEvent) => {
      const agent = this.deps.agentRegistry.get(agentId)
      if (agent && agent.state !== "completed" && agent.state !== "terminated") {
        this.deps.agentRegistry.transition(agentId, "failed")
        this.deps.threadService.appendThreadEvent(threadId, {
          type: "thread_agent_failed",
          agentId,
          reason: `Process exited with code ${exitEvent.code ?? "null"}, signal ${exitEvent.signal ?? "none"}`,
          timestamp: new Date().toISOString(),
        })
      }
    })

    this.deps.agentRegistry.register({
      agentId,
      threadId,
      agentType: "lead",
      parentAgentId: null,
      pid: handle.pid ?? 0,
      worktreePath,
      branchName,
      state: "booting",
      lastActivity: new Date().toISOString(),
      escalationLevel: 0,
    })

    this.deps.threadService.appendThreadEvent(threadId, {
      type: "thread_agent_started",
      agentId,
      agentType: "lead",
      timestamp: new Date().toISOString(),
    })
  }

  async handleAgentEvent(
    threadId: string,
    agentId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const eventType = event["type"] as string

    this.deps.agentRegistry.updateActivity(agentId, new Date().toISOString())

    switch (eventType) {
      case "status": {
        this.deps.agentRegistry.transition(agentId, "running")
        this.deps.threadService.appendThreadEvent(threadId, {
          type: "agent_progressed",
          agentId,
          message: event["message"] ?? "",
          timestamp: new Date().toISOString(),
        })
        break
      }

      case "spawn_agent": {
        const request: SpawnRequest = {
          agent_type: (event["agent_type"] as AgentType) ?? "builder",
          task: (event["task"] as string) ?? "",
          file_scope: (event["file_scope"] as string[]) ?? [],
        }
        await this.spawnSubAgent(threadId, agentId, request)
        break
      }

      case "agent_message": {
        this.deps.threadService.appendThreadEvent(threadId, {
          type: "agent_message",
          agentId,
          message: event["message"] ?? "",
          timestamp: new Date().toISOString(),
        })
        break
      }

      case "agent_done": {
        await this.completeAgent(threadId, agentId)
        break
      }

      default:
        break
    }
  }

  async spawnSubAgent(
    threadId: string,
    parentAgentId: string,
    request: SpawnRequest,
  ): Promise<void> {
    const activeCount = this.deps.agentRegistry.activeCountForThread(threadId)
    if (activeCount >= AGENT_LIMIT) {
      // Reject at limit
      return
    }

    const { agent_type: agentType, task, file_scope: fileScope } = request
    const suffix = randomSuffix()
    const agentId = `${threadId}_${agentType}_${suffix}`

    const parent = this.deps.agentRegistry.get(parentAgentId)
    if (!parent) return

    const repoRoot = this.threadRepoRoots.get(threadId) ?? parent.worktreePath
    const baseDir = join(repoRoot, WORKTREES_BASE)

    const { worktreePath, branchName } = await this.deps.worktreeManager.createWorktree({
      repoRoot,
      baseDir,
      baseBranch: parent.branchName,
      agentType,
      agentId,
      threadId,
    })

    const overlayContent = this.deps.overlayGenerator.generateOverlay({
      agentType,
      agentId,
      threadId,
      branchName,
      worktreePath,
      taskDescription: task,
      fileScope,
      parentAgentId,
      qualityGates: [],
    })

    mkdirSync(worktreePath, { recursive: true })
    writeFileSync(join(worktreePath, "CLAUDE.md"), overlayContent, "utf-8")

    this.deps.hooksDeployer.deployHooks(worktreePath, {
      agentType,
      agentId,
      branchName,
    })

    const handle = this.deps.processAdapter.spawn({
      componentType: "agent",
      scope: "project",
      command: "claude",
      args: ["--dangerously-skip-permissions"],
      cwd: worktreePath,
      env: {
        ULTRA_AGENT: "true",
        ULTRA_WORKTREE_PATH: worktreePath,
        ULTRA_AGENT_ID: agentId,
        ULTRA_THREAD_ID: threadId,
      },
    })

    this.handles.set(agentId, handle)

    if (isInteractiveSupervisedProcessHandle(handle)) {
      handle.onStdoutLine((line) => {
        const result = parseAgentLine(line)
        if (result.kind === "event") {
          void this.handleAgentEvent(threadId, agentId, result.event as Record<string, unknown>)
        }
      })
    }

    handle.onExit((exitEvent) => {
      const agent = this.deps.agentRegistry.get(agentId)
      if (agent && agent.state !== "completed" && agent.state !== "terminated") {
        this.deps.agentRegistry.transition(agentId, "failed")
        this.deps.threadService.appendThreadEvent(threadId, {
          type: "thread_agent_failed",
          agentId,
          reason: `Process exited with code ${exitEvent.code ?? "null"}, signal ${exitEvent.signal ?? "none"}`,
          timestamp: new Date().toISOString(),
        })
      }
    })

    this.deps.agentRegistry.register({
      agentId,
      threadId,
      agentType,
      parentAgentId,
      pid: handle.pid ?? 0,
      worktreePath,
      branchName,
      state: "booting",
      lastActivity: new Date().toISOString(),
      escalationLevel: 0,
    })

    this.deps.threadService.appendThreadEvent(threadId, {
      type: "thread_agent_started",
      agentId,
      agentType,
      parentAgentId,
      timestamp: new Date().toISOString(),
    })
  }

  async completeAgent(threadId: string, agentId: string): Promise<void> {
    const agent = this.deps.agentRegistry.get(agentId)
    if (!agent) return

    this.deps.agentRegistry.transition(agentId, "completing")

    const repoRoot = this.threadRepoRoots.get(threadId) ?? ""

    if (agent.parentAgentId !== null) {
      const parent = this.deps.agentRegistry.get(agent.parentAgentId)
      if (parent) {
        const mergeResult = await this.deps.mergeResolver.merge(
          parent.worktreePath,
          agent.branchName,
          { taskSummary: `Agent ${agentId} task complete` },
        )

        if (!mergeResult.success) {
          this.deps.agentRegistry.transition(agentId, "failed")
          this.deps.threadService.appendThreadEvent(threadId, {
            type: "thread_agent_failed",
            agentId,
            reason: mergeResult.error ?? "Merge failed",
            conflictFiles: mergeResult.conflictFiles ?? [],
            timestamp: new Date().toISOString(),
          })
          return
        }
      }
    }

    try {
      await this.deps.worktreeManager.removeWorktree(repoRoot, agent.worktreePath, {
        force: true,
        deleteBranch: agent.parentAgentId !== null,
        forceBranch: true,
      })
    } catch {
      // Best-effort removal; continue with state transition
    }

    this.deps.agentRegistry.transition(agentId, "completed")
    this.handles.delete(agentId)

    this.deps.threadService.appendThreadEvent(threadId, {
      type: "thread_agent_finished",
      agentId,
      timestamp: new Date().toISOString(),
    })
  }

  async terminateAgent(threadId: string, agentId: string, reason: string): Promise<void> {
    const handle = this.handles.get(agentId)
    if (handle) {
      handle.kill()
    }

    this.deps.agentRegistry.transition(agentId, "terminated")
    // Do NOT remove worktree — preserve for inspection

    this.deps.threadService.appendThreadEvent(threadId, {
      type: "thread_agent_failed",
      agentId,
      reason,
      timestamp: new Date().toISOString(),
    })
  }
}
