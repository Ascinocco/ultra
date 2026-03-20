export type AgentType = "lead" | "builder" | "scout" | "reviewer"

export type AgentState =
  | "pending" | "spawning" | "booting" | "running"
  | "completing" | "completed" | "failed"
  | "stalled" | "zombie" | "terminated"

export type AgentNode = {
  agentId: string
  threadId: string
  agentType: AgentType
  parentAgentId: string | null
  pid: number
  worktreePath: string
  branchName: string
  state: AgentState
  lastActivity: string
  escalationLevel: number
}

const ACTIVE_STATES = new Set<AgentState>(["pending", "spawning", "booting", "running"])

export class AgentRegistry {
  private readonly agents = new Map<string, AgentNode>()

  register(node: AgentNode): void {
    this.agents.set(node.agentId, { ...node })
  }

  get(agentId: string): AgentNode | undefined {
    return this.agents.get(agentId)
  }

  transition(agentId: string, newState: AgentState): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.state = newState
  }

  updateActivity(agentId: string, timestamp: string): void {
    const agent = this.agents.get(agentId)
    if (agent) agent.lastActivity = timestamp
  }

  activeCountForThread(threadId: string): number {
    let count = 0
    for (const agent of this.agents.values()) {
      if (agent.threadId === threadId && ACTIVE_STATES.has(agent.state)) count++
    }
    return count
  }

  getByThread(threadId: string): AgentNode[] {
    return [...this.agents.values()].filter((a) => a.threadId === threadId)
  }

  getChildren(parentAgentId: string): AgentNode[] {
    return [...this.agents.values()].filter((a) => a.parentAgentId === parentAgentId)
  }

  allActive(): AgentNode[] {
    return [...this.agents.values()].filter((a) => ACTIVE_STATES.has(a.state))
  }

  getAll(): AgentNode[] {
    return [...this.agents.values()]
  }
}
