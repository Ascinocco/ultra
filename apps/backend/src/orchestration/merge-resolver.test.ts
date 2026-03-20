import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createMergeResolver } from "./merge-resolver.js"

function initTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ultra-merge-test-"))
  execFileSync("git", ["init", dir])
  execFileSync("git", ["-C", dir, "config", "user.email", "test@test.com"])
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"])
  // Ensure we're on 'main' branch regardless of git default
  execFileSync("git", ["-C", dir, "checkout", "-b", "main"])
  writeFileSync(join(dir, "file.ts"), "line 1\n")
  execFileSync("git", ["-C", dir, "add", "."])
  execFileSync("git", ["-C", dir, "commit", "-m", "init"])
  return dir
}

describe("MergeResolver", () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = initTestRepo()
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it("tier 1: merges cleanly when no conflicts", async () => {
    execFileSync("git", ["-C", repoRoot, "checkout", "-b", "feature"])
    writeFileSync(join(repoRoot, "new-file.ts"), "new content\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "add new file"])
    execFileSync("git", ["-C", repoRoot, "checkout", "main"])

    const resolver = createMergeResolver({})
    const result = await resolver.merge(repoRoot, "feature", { taskSummary: "test" })

    expect(result.success).toBe(true)
    expect(result.tier).toBe(1)
  })

  it("tier 2: auto-resolves conflicts with empty canonical", async () => {
    execFileSync("git", ["-C", repoRoot, "checkout", "-b", "feature"])
    writeFileSync(join(repoRoot, "file.ts"), "agent change\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "agent change"])
    execFileSync("git", ["-C", repoRoot, "checkout", "main"])

    writeFileSync(join(repoRoot, "file.ts"), "\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "main change"])

    const resolver = createMergeResolver({})
    const result = await resolver.merge(repoRoot, "feature", { taskSummary: "test" })

    expect(result.success).toBe(true)
    expect(result.tier).toBeLessThanOrEqual(2)
  })

  it("detects contentful canonical and escalates past tier 2", async () => {
    execFileSync("git", ["-C", repoRoot, "checkout", "-b", "feature"])
    writeFileSync(join(repoRoot, "file.ts"), "agent implementation\nwith multiple lines\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "agent change"])
    execFileSync("git", ["-C", repoRoot, "checkout", "main"])

    writeFileSync(join(repoRoot, "file.ts"), "canonical implementation\nwith real content\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "main change"])

    // No AI callback — should fail at tier 3+
    const resolver = createMergeResolver({})
    const result = await resolver.merge(repoRoot, "feature", { taskSummary: "test" })

    // Without AI, conflicts with contentful canonical can't be resolved
    expect(result.success).toBe(false)
    expect(result.tier).toBeGreaterThanOrEqual(3)
  })

  it("looksLikeProse catches explanation output", async () => {
    // Test the prose detection through AI resolve path
    execFileSync("git", ["-C", repoRoot, "checkout", "-b", "feature"])
    writeFileSync(join(repoRoot, "file.ts"), "agent code\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "agent"])
    execFileSync("git", ["-C", repoRoot, "checkout", "main"])

    writeFileSync(join(repoRoot, "file.ts"), "main code\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "main"])

    const resolver = createMergeResolver({
      resolveWithAI: async () =>
        "Here's the resolved file:\n\nI've merged both changes by keeping the best parts of each.",
    })
    const result = await resolver.merge(repoRoot, "feature", { taskSummary: "test" })

    // Prose output should be rejected
    expect(result.success).toBe(false)
  })

  it("tier 3: AI-resolves conflicts when callback provided", async () => {
    execFileSync("git", ["-C", repoRoot, "checkout", "-b", "feature"])
    writeFileSync(join(repoRoot, "file.ts"), "agent implementation\nwith multiple lines\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "agent change"])
    execFileSync("git", ["-C", repoRoot, "checkout", "main"])

    writeFileSync(join(repoRoot, "file.ts"), "canonical implementation\nwith real content\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "main change"])

    // AI returns valid code (not prose)
    const resolver = createMergeResolver({
      resolveWithAI: async () => "merged implementation\nwith combined lines\n",
    })
    const result = await resolver.merge(repoRoot, "feature", { taskSummary: "test" })

    expect(result.success).toBe(true)
    expect(result.tier).toBe(3)
  })

  it("serializes concurrent merges for the same thread via queue", async () => {
    // Create two feature branches that both modify file.ts
    execFileSync("git", ["-C", repoRoot, "checkout", "-b", "feat-a"])
    writeFileSync(join(repoRoot, "a.ts"), "file a\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "feat-a"])
    execFileSync("git", ["-C", repoRoot, "checkout", "main"])

    execFileSync("git", ["-C", repoRoot, "checkout", "-b", "feat-b"])
    writeFileSync(join(repoRoot, "b.ts"), "file b\n")
    execFileSync("git", ["-C", repoRoot, "add", "."])
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "feat-b"])
    execFileSync("git", ["-C", repoRoot, "checkout", "main"])

    const resolver = createMergeResolver({})
    // Fire both merges concurrently
    const [r1, r2] = await Promise.all([
      resolver.merge(repoRoot, "feat-a", { taskSummary: "test", threadId: "thread-1" }),
      resolver.merge(repoRoot, "feat-b", { taskSummary: "test", threadId: "thread-1" }),
    ])

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
  })
})
