import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { deployHooks } from "./hooks-deployer.js"

describe("hooks-deployer", () => {
  let worktreePath: string

  beforeEach(() => {
    worktreePath = mkdtempSync(join(tmpdir(), "ultra-hooks-test-"))
  })

  afterEach(() => {
    rmSync(worktreePath, { recursive: true, force: true })
  })

  it("creates settings.local.json with orchestration hooks", () => {
    deployHooks(worktreePath, {
      agentType: "builder",
      agentId: "agt_123",
      branchName: "ultra/thr_1/builder-agt_123",
    })

    const settingsPath = join(worktreePath, ".claude", "settings.local.json")
    const content = JSON.parse(readFileSync(settingsPath, "utf-8"))

    expect(content.hooks).toBeDefined()
    expect(content.hooks.PreToolUse).toBeDefined()
    expect(content.hooks.PreToolUse.length).toBeGreaterThan(0)
  })

  it("preserves existing user hooks when merging", () => {
    const claudeDir = join(worktreePath, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, "settings.local.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "custom", command: "echo user-hook" }],
        },
        permissions: { allow: ["Read"] },
      }),
    )

    deployHooks(worktreePath, {
      agentType: "builder",
      agentId: "agt_123",
      branchName: "ultra/thr_1/builder-agt_123",
    })

    const content = JSON.parse(readFileSync(join(claudeDir, "settings.local.json"), "utf-8"))

    // User hook preserved
    const userHook = content.hooks.PreToolUse.find(
      (h: any) => h.command === "echo user-hook",
    )
    expect(userHook).toBeDefined()

    // Orchestration hooks added
    const ultraHooks = content.hooks.PreToolUse.filter(
      (h: any) => h.command?.includes("ultra-orchestration-hook"),
    )
    expect(ultraHooks.length).toBeGreaterThan(0)

    // Permissions preserved
    expect(content.permissions.allow).toContain("Read")
  })

  it("generates read-only guards for scout agents", () => {
    deployHooks(worktreePath, {
      agentType: "scout",
      agentId: "agt_456",
      branchName: "ultra/thr_1/scout-agt_456",
    })

    const content = JSON.parse(
      readFileSync(join(worktreePath, ".claude", "settings.local.json"), "utf-8"),
    )

    // Should have hooks blocking Write/Edit
    const hookCommands = content.hooks.PreToolUse.map((h: any) => h.command).join("\n")
    expect(hookCommands).toContain("Write")
    expect(hookCommands).toContain("Edit")
  })
})
