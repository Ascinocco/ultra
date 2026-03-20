import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"
import { WorktreeError } from "./orchestration-errors.js"

const execFileAsync = promisify(execFile)

/**
 * Run a git command and return stdout. Throws WorktreeError on non-zero exit.
 */
async function runGit(
  repoRoot: string,
  args: string[],
  context?: { worktreePath?: string; branchName?: string },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: repoRoot })
    return stdout
  } catch (err: unknown) {
    const exitCode = (err as NodeJS.ErrnoException & { code?: number | string })?.code
    const stderr =
      (err as { stderr?: string })?.stderr?.trim() ??
      (err instanceof Error ? err.message : String(err))
    throw new WorktreeError(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`,
      {
        ...(context?.worktreePath !== undefined ? { worktreePath: context.worktreePath } : {}),
        ...(context?.branchName !== undefined ? { branchName: context.branchName } : {}),
      },
    )
  }
}

/**
 * Create a new git worktree for an agent.
 *
 * Creates a worktree at `{baseDir}/{agentType}-{agentId}` with a new branch
 * named `ultra/{threadId}/{agentType}-{agentId}` based on `baseBranch`.
 * Special case: when agentType is "lead", the branch is `ultra/{threadId}/lead`.
 *
 * @returns The absolute worktree path and branch name.
 */
export async function createWorktree(options: {
  repoRoot: string
  baseDir: string
  baseBranch: string
  agentType: string
  agentId: string
  threadId: string
}): Promise<{ worktreePath: string; branchName: string }> {
  const { repoRoot, baseDir, baseBranch, agentType, agentId, threadId } = options

  const worktreePath = join(baseDir, `${agentType}-${agentId}`)
  const branchName =
    agentType === "lead"
      ? `ultra/${threadId}/lead`
      : `ultra/${threadId}/${agentType}-${agentId}`

  await runGit(repoRoot, ["worktree", "add", "-b", branchName, worktreePath, baseBranch], {
    worktreePath,
    branchName,
  })

  return { worktreePath, branchName }
}

/**
 * Parsed representation of a single worktree entry from `git worktree list --porcelain`.
 */
interface WorktreeEntry {
  path: string
  branch: string
  head: string
}

/**
 * Parse the output of `git worktree list --porcelain` into structured entries.
 *
 * Porcelain format example:
 * ```
 * worktree /path/to/main
 * HEAD abc123
 * branch refs/heads/main
 *
 * worktree /path/to/wt
 * HEAD def456
 * branch refs/heads/ultra/thr_123/builder-agt_456
 * ```
 */
function parseWorktreeOutput(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  const blocks = output.trim().split("\n\n")

  for (const block of blocks) {
    if (block.trim() === "") continue

    let path = ""
    let head = ""
    let branch = ""

    const lines = block.trim().split("\n")
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length)
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length)
      } else if (line.startsWith("branch ")) {
        // Strip refs/heads/ prefix to get the short branch name
        const ref = line.slice("branch ".length)
        branch = ref.replace(/^refs\/heads\//, "")
      }
    }

    if (path.length > 0) {
      entries.push({ path, head, branch })
    }
  }

  return entries
}

/**
 * List all git worktrees in the repository.
 *
 * @returns Array of worktree entries with path, branch name, and HEAD commit.
 */
export async function listWorktrees(
  repoRoot: string,
): Promise<Array<{ path: string; branch: string; head: string }>> {
  const stdout = await runGit(repoRoot, ["worktree", "list", "--porcelain"])
  return parseWorktreeOutput(stdout)
}

/**
 * Check if a branch has been merged into a target branch.
 * Uses `git merge-base --is-ancestor` which returns exit 0 if merged, 1 if not.
 */
export async function isBranchMerged(
  repoRoot: string,
  branch: string,
  targetBranch: string,
): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", branch, targetBranch], {
      cwd: repoRoot,
    })
    return true
  } catch (err: unknown) {
    const exitCode = (err as { status?: number })?.status
    if (exitCode === 1) return false

    const stderr = (err as { stderr?: string })?.stderr?.trim() ?? ""
    throw new WorktreeError(
      `git merge-base --is-ancestor failed (exit ${exitCode}): ${stderr}`,
      { branchName: branch },
    )
  }
}

/**
 * Remove a git worktree and optionally delete its associated branch.
 *
 * Runs `git worktree remove {path}` to remove the worktree, then
 * deletes the branch when `deleteBranch` is true. With `forceBranch: true`,
 * uses `git branch -D` to force-delete even unmerged branches. Otherwise
 * uses `git branch -d` which only deletes merged branches.
 */
export async function removeWorktree(
  repoRoot: string,
  path: string,
  options?: { force?: boolean; deleteBranch?: boolean; forceBranch?: boolean },
): Promise<void> {
  // First, figure out which branch this worktree is on so we can clean it up
  const worktrees = await listWorktrees(repoRoot)
  const entry = worktrees.find((wt) => wt.path === path)
  const branchName = entry?.branch ?? ""

  // Remove the worktree (--force handles untracked files and uncommitted changes)
  const removeArgs = ["worktree", "remove", path]
  if (options?.force) {
    removeArgs.push("--force")
  }
  await runGit(repoRoot, removeArgs, {
    worktreePath: path,
    branchName,
  })

  // Delete the associated branch after worktree removal.
  // Use -D (force) when forceBranch is set, since the branch may not have
  // been merged yet. Use -d (safe) otherwise, which only deletes merged branches.
  if (options?.deleteBranch && branchName.length > 0) {
    const deleteFlag = options?.forceBranch ? "-D" : "-d"
    try {
      await runGit(repoRoot, ["branch", deleteFlag, branchName], { branchName })
    } catch {
      // Branch deletion failed — may be unmerged (with -d) or checked out elsewhere.
      // This is best-effort; the worktree itself is already removed.
    }
  }
}

/**
 * Roll back a worktree and its associated branch after a failed operation.
 *
 * Best-effort cleanup: errors are swallowed because the caller's original
 * error is more important. Always call this inside a catch block.
 */
export async function rollbackWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  try {
    await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: repoRoot,
    })
  } catch {
    // Best-effort
  }

  if (branchName.length > 0) {
    try {
      await execFileAsync("git", ["branch", "-D", branchName], {
        cwd: repoRoot,
      })
    } catch {
      // Best-effort
    }
  }
}
