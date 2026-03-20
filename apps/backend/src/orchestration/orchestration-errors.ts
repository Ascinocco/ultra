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
    if (context?.worktreePath !== undefined) {
      this.worktreePath = context.worktreePath
    }
    if (context?.branchName !== undefined) {
      this.branchName = context.branchName
    }
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
    if (context?.branchName !== undefined) {
      this.branchName = context.branchName
    }
    if (context?.conflictFiles !== undefined) {
      this.conflictFiles = context.conflictFiles
    }
    if (context?.tier !== undefined) {
      this.tier = context.tier
    }
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
    if (context?.agentId !== undefined) {
      this.agentId = context.agentId
    }
    if (context?.agentType !== undefined) {
      this.agentType = context.agentType
    }
  }
}
