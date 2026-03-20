import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  rollbackWorktree,
  isBranchMerged,
} from "./worktree-manager.js"

function initTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ultra-wt-test-"))
  execFileSync("git", ["init", dir])
  execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"])
  return dir
}

describe("WorktreeManager", () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = initTestRepo()
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  describe("createWorktree", () => {
    it("creates a worktree with the correct branch name", async () => {
      const result = await createWorktree({
        repoRoot,
        baseDir: join(repoRoot, ".ultra", "worktrees", "thr_123"),
        baseBranch: "main",
        agentType: "builder",
        agentId: "agt_456",
        threadId: "thr_123",
      })

      expect(result.branchName).toBe("ultra/thr_123/builder-agt_456")
      expect(result.worktreePath).toContain("builder-agt_456")

      const worktrees = await listWorktrees(repoRoot)
      const found = worktrees.find((w) => w.branch === result.branchName)
      expect(found).toBeDefined()
    })

    it("creates lead worktree with lead branch name", async () => {
      const result = await createWorktree({
        repoRoot,
        baseDir: join(repoRoot, ".ultra", "worktrees", "thr_123"),
        baseBranch: "main",
        agentType: "lead",
        agentId: "lead",
        threadId: "thr_123",
      })

      expect(result.branchName).toBe("ultra/thr_123/lead")
    })
  })

  describe("removeWorktree", () => {
    it("removes worktree and deletes merged branch", async () => {
      const { worktreePath, branchName } = await createWorktree({
        repoRoot,
        baseDir: join(repoRoot, ".ultra", "worktrees", "thr_123"),
        baseBranch: "main",
        agentType: "scout",
        agentId: "agt_789",
        threadId: "thr_123",
      })

      await removeWorktree(repoRoot, worktreePath, { deleteBranch: true })

      const worktrees = await listWorktrees(repoRoot)
      expect(worktrees.find((w) => w.branch === branchName)).toBeUndefined()
    })
  })

  describe("isBranchMerged", () => {
    it("returns true when branch is ancestor of target", async () => {
      const merged = await isBranchMerged(repoRoot, "main", "main")
      expect(merged).toBe(true)
    })
  })

  describe("rollbackWorktree", () => {
    it("cleans up worktree and branch on failure", async () => {
      const { worktreePath, branchName } = await createWorktree({
        repoRoot,
        baseDir: join(repoRoot, ".ultra", "worktrees", "thr_123"),
        baseBranch: "main",
        agentType: "builder",
        agentId: "agt_000",
        threadId: "thr_123",
      })

      await rollbackWorktree(repoRoot, worktreePath, branchName)

      const worktrees = await listWorktrees(repoRoot)
      expect(worktrees.find((w) => w.branch === branchName)).toBeUndefined()
    })
  })
})
