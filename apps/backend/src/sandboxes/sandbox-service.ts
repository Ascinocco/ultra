import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { ProjectId, SandboxContextSnapshot } from "@ultra/shared"

import type { SandboxPersistenceService } from "./sandbox-persistence-service.js"

const execFileAsync = promisify(execFile)

type ActivationSyncHandler = (projectId: ProjectId, sandboxId: string) => void

type GitWorktreeEntry = {
  path: string
  branch: string | null
  bare: boolean
}

export class SandboxService {
  private activationSyncHandler: ActivationSyncHandler | null = null

  constructor(private readonly persistenceService: SandboxPersistenceService) {}

  setActivationSyncHandler(handler: ActivationSyncHandler): void {
    this.activationSyncHandler = handler
  }

  list(projectId: ProjectId): { sandboxes: SandboxContextSnapshot[] } {
    return {
      sandboxes: this.persistenceService.listSandboxes(projectId),
    }
  }

  getActive(projectId: ProjectId): SandboxContextSnapshot {
    return this.persistenceService.getActiveSandbox(projectId)
  }

  getSandbox(projectId: ProjectId, sandboxId: string): SandboxContextSnapshot {
    return this.persistenceService.getSandbox(projectId, sandboxId)
  }

  setActive(projectId: ProjectId, sandboxId: string): SandboxContextSnapshot {
    const sandbox = this.persistenceService.setActiveSandbox(
      projectId,
      sandboxId,
    )

    if (this.activationSyncHandler) {
      try {
        this.activationSyncHandler(projectId, sandboxId)
      } catch {
        // Activation should not fail just because runtime sync could not complete.
      }
    }

    return sandbox
  }

  resolveThreadSandbox(
    projectId: ProjectId,
    threadId: string,
  ): SandboxContextSnapshot | null {
    return this.persistenceService.findThreadSandbox(projectId, threadId)
  }

  /**
   * Reconcile sandbox_contexts against actual git worktrees.
   * Creates user_worktree sandboxes for worktrees not in the DB.
   * Removes stale user_worktree rows for worktrees that no longer exist.
   */
  async reconcileWorktrees(
    projectId: ProjectId,
    gitRootPath: string,
  ): Promise<{ created: number; removed: number }> {
    const worktrees = await listGitWorktrees(gitRootPath)

    // The main worktree path is the git root itself — skip it (handled by main_checkout)
    const externalWorktrees = worktrees.filter(
      (wt) => !wt.bare && wt.path !== gitRootPath,
    )

    // Upsert user_worktree for each external worktree
    let created = 0
    const activePaths = new Set<string>()

    for (const wt of externalWorktrees) {
      activePaths.add(wt.path)

      // Check if this path already exists as any sandbox type
      const existing = this.persistenceService.listSandboxes(projectId)
        .find((s) => s.path === wt.path)

      // Only create if it doesn't exist as any sandbox type
      if (!existing) {
        this.persistenceService.upsertUserWorktree({
          projectId,
          path: wt.path,
          branchName: wt.branch,
        })
        created++
      }
    }

    // Remove stale user_worktree rows
    const removed = this.persistenceService.removeStaleWorktrees(
      projectId,
      activePaths,
    )

    return { created, removed }
  }
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 */
function parseGitWorktreeOutput(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  let current: Partial<GitWorktreeEntry> = {}

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        entries.push({
          path: current.path,
          branch: current.branch ?? null,
          bare: current.bare ?? false,
        })
      }
      current = { path: line.slice("worktree ".length) }
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length)
      // refs/heads/feature/auth → feature/auth
      current.branch = ref.startsWith("refs/heads/")
        ? ref.slice("refs/heads/".length)
        : ref
    } else if (line === "bare") {
      current.bare = true
    }
  }

  // Push last entry
  if (current.path) {
    entries.push({
      path: current.path,
      branch: current.branch ?? null,
      bare: current.bare ?? false,
    })
  }

  return entries
}

async function listGitWorktrees(gitRootPath: string): Promise<GitWorktreeEntry[]> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: gitRootPath,
      timeout: 5000,
    })
    return parseGitWorktreeOutput(stdout)
  } catch {
    // If git command fails (not a git repo, git not installed, etc.), return empty
    return []
  }
}
