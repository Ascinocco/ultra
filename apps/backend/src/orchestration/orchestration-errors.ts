export class OrchestrationError extends Error {
  readonly code: string
  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "OrchestrationError"
    this.code = code
  }
}

export class WorktreeError extends OrchestrationError {
  readonly worktreePath?: string
  readonly branchName?: string
  constructor(
    message: string,
    context?: { worktreePath?: string; branchName?: string; cause?: unknown },
  ) {
    super(message, "worktree_error", { cause: context?.cause })
    this.name = "WorktreeError"
    this.worktreePath = context?.worktreePath
    this.branchName = context?.branchName
  }
}

export class MergeError extends OrchestrationError {
  readonly branchName?: string
  readonly conflictFiles?: string[]
  readonly tier?: number
  constructor(
    message: string,
    context?: { branchName?: string; conflictFiles?: string[]; tier?: number; cause?: unknown },
  ) {
    super(message, "merge_error", { cause: context?.cause })
    this.name = "MergeError"
    this.branchName = context?.branchName
    this.conflictFiles = context?.conflictFiles
    this.tier = context?.tier
  }
}

export class AgentError extends OrchestrationError {
  readonly agentId?: string
  readonly agentType?: string
  constructor(
    message: string,
    context?: { agentId?: string; agentType?: string; cause?: unknown },
  ) {
    super(message, "agent_error", { cause: context?.cause })
    this.name = "AgentError"
    this.agentId = context?.agentId
    this.agentType = context?.agentType
  }
}
