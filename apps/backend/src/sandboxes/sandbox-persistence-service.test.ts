import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { SandboxPersistenceService } from "./sandbox-persistence-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  firstProjectPath: string
  secondProjectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-sandbox-service-"))
  const firstProjectPath = join(directory, "project-one")
  const secondProjectPath = join(directory, "project-two")
  temporaryDirectories.push(directory)
  mkdirSync(firstProjectPath)
  mkdirSync(secondProjectPath)

  return {
    databasePath: join(directory, "ultra.db"),
    firstProjectPath,
    secondProjectPath,
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("SandboxPersistenceService", () => {
  it("keeps ensureMainCheckoutSandbox idempotent and lists the main sandbox", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const sandboxService = new SandboxPersistenceService(
      runtime.database,
      () => "2026-03-15T18:00:00Z",
    )
    const project = projectService.open({ path: firstProjectPath })

    const first = sandboxService.ensureMainCheckoutSandbox(project.id)
    const second = sandboxService.ensureMainCheckoutSandbox(project.id)
    const listed = sandboxService.listSandboxes(project.id)

    expect(first.sandboxId).toBe(second.sandboxId)
    expect(first.sandboxType).toBe("main_checkout")
    expect(first.isMainCheckout).toBe(true)
    expect(listed).toEqual([
      expect.objectContaining({ sandboxId: first.sandboxId }),
    ])

    runtime.close()
  })

  it("falls back to the main sandbox when no active sandbox is stored", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const sandboxService = new SandboxPersistenceService(
      runtime.database,
      () => "2026-03-15T18:05:00Z",
    )
    const project = projectService.open({ path: firstProjectPath })

    runtime.database
      .prepare(
        "UPDATE project_layout_state SET last_active_sandbox_id = NULL WHERE project_id = ?",
      )
      .run(project.id)

    const active = sandboxService.getActiveSandbox(project.id)

    expect(active.path).toBe(project.rootPath)
    expect(active.sandboxType).toBe("main_checkout")

    runtime.close()
  })

  it("sets active sandbox within a project, updates last_used_at, and rejects cross-project activation", () => {
    const { databasePath, firstProjectPath, secondProjectPath } =
      createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T18:10:0${tick}Z`
    }
    const sandboxService = new SandboxPersistenceService(runtime.database, now)
    const firstProject = projectService.open({ path: firstProjectPath })
    const secondProject = projectService.open({ path: secondProjectPath })

    runtime.database
      .prepare(
        "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "chat_1",
        firstProject.id,
        "Chat 1",
        "active",
        "codex",
        "gpt-5-codex",
        "standard",
        "supervised",
        "2026-03-15T18:10:00Z",
        "2026-03-15T18:10:00Z",
      )
    runtime.database
      .prepare(
        "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "thread_1",
        firstProject.id,
        "chat_1",
        "Thread 1",
        "queued",
        "not_ready",
        "not_requested",
        "2026-03-15T18:10:00Z",
        "2026-03-15T18:10:00Z",
      )
    runtime.database
      .prepare(
        "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "chat_2",
        secondProject.id,
        "Chat 2",
        "active",
        "codex",
        "gpt-5-codex",
        "standard",
        "supervised",
        "2026-03-15T18:10:00Z",
        "2026-03-15T18:10:00Z",
      )
    runtime.database
      .prepare(
        "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "thread_2",
        secondProject.id,
        "chat_2",
        "Thread 2",
        "queued",
        "not_ready",
        "not_requested",
        "2026-03-15T18:10:00Z",
        "2026-03-15T18:10:00Z",
      )

    const firstThreadSandbox = sandboxService.upsertThreadSandbox({
      projectId: firstProject.id,
      threadId: "thread_1",
      path: join(firstProjectPath, ".sandbox-thread-1"),
      displayName: "Thread 1 Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const secondThreadSandbox = sandboxService.upsertThreadSandbox({
      projectId: secondProject.id,
      threadId: "thread_2",
      path: join(secondProjectPath, ".sandbox-thread-2"),
      displayName: "Thread 2 Sandbox",
      branchName: "thread/two",
      baseBranch: "main",
    })

    const activated = sandboxService.setActiveSandbox(
      firstProject.id,
      firstThreadSandbox.sandboxId,
    )
    const layout = runtime.database
      .prepare(
        "SELECT last_active_sandbox_id FROM project_layout_state WHERE project_id = ?",
      )
      .get(firstProject.id) as
      | { last_active_sandbox_id: string | null }
      | undefined

    expect(activated.sandboxId).toBe(firstThreadSandbox.sandboxId)
    expect(activated.lastUsedAt).toBe("2026-03-15T18:10:03Z")
    expect(layout?.last_active_sandbox_id).toBe(firstThreadSandbox.sandboxId)
    expect(() =>
      sandboxService.setActiveSandbox(
        firstProject.id,
        secondThreadSandbox.sandboxId,
      ),
    ).toThrow(/Sandbox not found for project/)

    runtime.close()
  })

  it("lazily creates the default runtime profile", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const sandboxService = new SandboxPersistenceService(
      runtime.database,
      () => "2026-03-15T18:15:00Z",
    )
    const project = projectService.open({ path: firstProjectPath })

    const profile = sandboxService.getRuntimeProfile(project.id)
    const persisted = runtime.database
      .prepare(
        "SELECT runtime_file_paths_json, env_vars_json FROM project_runtime_profiles WHERE project_id = ?",
      )
      .get(project.id) as
      | {
          runtime_file_paths_json: string
          env_vars_json: string
        }
      | undefined

    expect(profile.runtimeFilePaths).toEqual([".env"])
    expect(profile.envVars).toEqual({})
    expect(persisted).toEqual({
      runtime_file_paths_json: '[".env"]',
      env_vars_json: "{}",
    })

    runtime.close()
  })

  it("returns synthesized unknown runtime sync state when no sync row exists", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const sandboxService = new SandboxPersistenceService(
      runtime.database,
      () => "2026-03-15T18:20:00Z",
    )
    const project = projectService.open({ path: firstProjectPath })
    const mainSandbox = sandboxService.getActiveSandbox(project.id)

    const sync = sandboxService.getRuntimeSync(mainSandbox.sandboxId)
    const persistedCount = runtime.database
      .prepare(
        "SELECT COUNT(*) AS count FROM sandbox_runtime_syncs WHERE sandbox_id = ?",
      )
      .get(mainSandbox.sandboxId) as { count: number }

    expect(sync.status).toBe("unknown")
    expect(sync.syncMode).toBe("managed_copy")
    expect(sync.syncedFiles).toEqual([])
    expect(persistedCount.count).toBe(0)

    runtime.close()
  })

  it("round-trips synced, stale, and failed runtime sync rows", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T18:25:0${tick}Z`
    }
    const sandboxService = new SandboxPersistenceService(runtime.database, now)
    const project = projectService.open({ path: firstProjectPath })
    const mainSandbox = sandboxService.getActiveSandbox(project.id)

    const synced = sandboxService.upsertRuntimeSync({
      sandboxId: mainSandbox.sandboxId,
      status: "synced",
      syncedFiles: [".env"],
      lastSyncedAt: "2026-03-15T18:25:10Z",
      details: { copiedFrom: project.rootPath },
    })
    const stale = sandboxService.upsertRuntimeSync({
      sandboxId: mainSandbox.sandboxId,
      status: "stale",
      syncedFiles: [".env"],
      lastSyncedAt: "2026-03-15T18:25:10Z",
      details: { reason: "file_changed" },
    })
    const failed = sandboxService.upsertRuntimeSync({
      sandboxId: mainSandbox.sandboxId,
      status: "failed",
      syncedFiles: [".env"],
      details: { error: "copy failed" },
    })

    expect(stale.syncId).toBe(synced.syncId)
    expect(stale.status).toBe("stale")
    expect(failed.syncId).toBe(synced.syncId)
    expect(failed.status).toBe("failed")
    expect(failed.syncedFiles).toEqual([".env"])
    expect(failed.details).toEqual({ error: "copy failed" })

    runtime.close()
  })
})
