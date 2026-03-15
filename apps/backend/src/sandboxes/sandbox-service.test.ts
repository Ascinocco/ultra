import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { SandboxPersistenceService } from "./sandbox-persistence-service.js"
import { SandboxService } from "./sandbox-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  firstProjectPath: string
  secondProjectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-sandbox-public-"))
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

function seedThread(
  database: ReturnType<typeof bootstrapDatabase>["database"],
  projectId: string,
  chatId: string,
  threadId: string,
): void {
  database
    .prepare(
      "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      chatId,
      projectId,
      `Chat ${chatId}`,
      "active",
      "codex",
      "gpt-5-codex",
      "standard",
      "supervised",
      "2026-03-15T19:00:00Z",
      "2026-03-15T19:00:00Z",
    )

  database
    .prepare(
      "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      threadId,
      projectId,
      chatId,
      `Thread ${threadId}`,
      "queued",
      "not_ready",
      "not_requested",
      "2026-03-15T19:00:00Z",
      "2026-03-15T19:00:00Z",
    )
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("SandboxService", () => {
  it("lists at least the main checkout sandbox and keeps it first", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T19:00:0${tick}Z`
    }
    const persistenceService = new SandboxPersistenceService(
      runtime.database,
      now,
    )
    const sandboxService = new SandboxService(persistenceService)
    const project = projectService.open({ path: firstProjectPath })

    seedThread(runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: join(firstProjectPath, ".sandbox-thread-1"),
      displayName: "Thread 1 Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    sandboxService.setActive(project.id, threadSandbox.sandboxId)

    const listed = sandboxService.list(project.id)

    expect(listed.sandboxes).toHaveLength(2)
    expect(listed.sandboxes[0]).toMatchObject({
      sandboxType: "main_checkout",
      isMainCheckout: true,
    })
    expect(listed.sandboxes[1]?.sandboxId).toBe(threadSandbox.sandboxId)

    runtime.close()
  })

  it("falls back to the main checkout sandbox when no active sandbox is stored", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistenceService = new SandboxPersistenceService(
      runtime.database,
      () => "2026-03-15T19:05:00Z",
    )
    const sandboxService = new SandboxService(persistenceService)
    const project = projectService.open({ path: firstProjectPath })

    runtime.database
      .prepare(
        "UPDATE project_layout_state SET last_active_sandbox_id = NULL WHERE project_id = ?",
      )
      .run(project.id)

    const active = sandboxService.getActive(project.id)

    expect(active).toMatchObject({
      projectId: project.id,
      path: project.rootPath,
      sandboxType: "main_checkout",
      isMainCheckout: true,
    })

    runtime.close()
  })

  it("falls back to main when the stored active sandbox belongs to another project", () => {
    const { databasePath, firstProjectPath, secondProjectPath } =
      createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistenceService = new SandboxPersistenceService(
      runtime.database,
      () => "2026-03-15T19:10:00Z",
    )
    const sandboxService = new SandboxService(persistenceService)
    const project = projectService.open({ path: firstProjectPath })
    const otherProject = projectService.open({ path: secondProjectPath })
    const otherMainSandbox = persistenceService.ensureMainCheckoutSandbox(
      otherProject.id,
    )

    runtime.database
      .prepare(
        "UPDATE project_layout_state SET last_active_sandbox_id = ? WHERE project_id = ?",
      )
      .run(otherMainSandbox.sandboxId, project.id)

    const active = sandboxService.getActive(project.id)

    expect(active.sandboxType).toBe("main_checkout")
    expect(active.path).toBe(project.rootPath)

    runtime.close()
  })

  it("sets the active sandbox, updates last_used_at, and rejects cross-project activation", () => {
    const { databasePath, firstProjectPath, secondProjectPath } =
      createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T19:15:0${tick}Z`
    }
    const persistenceService = new SandboxPersistenceService(
      runtime.database,
      now,
    )
    const sandboxService = new SandboxService(persistenceService)
    const firstProject = projectService.open({ path: firstProjectPath })
    const secondProject = projectService.open({ path: secondProjectPath })

    seedThread(runtime.database, firstProject.id, "chat_1", "thread_1")
    seedThread(runtime.database, secondProject.id, "chat_2", "thread_2")

    const firstThreadSandbox = persistenceService.upsertThreadSandbox({
      projectId: firstProject.id,
      threadId: "thread_1",
      path: join(firstProjectPath, ".sandbox-thread-1"),
      displayName: "Thread 1 Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const secondThreadSandbox = persistenceService.upsertThreadSandbox({
      projectId: secondProject.id,
      threadId: "thread_2",
      path: join(secondProjectPath, ".sandbox-thread-2"),
      displayName: "Thread 2 Sandbox",
      branchName: "thread/two",
      baseBranch: "main",
    })

    const activated = sandboxService.setActive(
      firstProject.id,
      firstThreadSandbox.sandboxId,
    )

    expect(activated.sandboxId).toBe(firstThreadSandbox.sandboxId)
    expect(activated.lastUsedAt).toBe("2026-03-15T19:15:03Z")
    expect(() =>
      sandboxService.setActive(firstProject.id, secondThreadSandbox.sandboxId),
    ).toThrow(/Sandbox not found for project/)

    runtime.close()
  })

  it("resolves a persisted thread sandbox and returns null when none exists", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistenceService = new SandboxPersistenceService(
      runtime.database,
      () => "2026-03-15T19:20:00Z",
    )
    const sandboxService = new SandboxService(persistenceService)
    const project = projectService.open({ path: firstProjectPath })

    seedThread(runtime.database, project.id, "chat_1", "thread_1")
    seedThread(runtime.database, project.id, "chat_2", "thread_2")
    const persisted = persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: join(firstProjectPath, ".sandbox-thread-1"),
      displayName: "Thread 1 Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })

    expect(sandboxService.resolveThreadSandbox(project.id, "thread_1")).toEqual(
      expect.objectContaining({ sandboxId: persisted.sandboxId }),
    )
    expect(
      sandboxService.resolveThreadSandbox(project.id, "thread_2"),
    ).toBeNull()

    runtime.close()
  })
})
