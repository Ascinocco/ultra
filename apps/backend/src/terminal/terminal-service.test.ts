import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "../sandboxes/sandbox-service.js"
import { RuntimeProfileService } from "./runtime-profile-service.js"
import { RuntimeSyncService } from "./runtime-sync-service.js"
import { TerminalService } from "./terminal-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  firstProjectPath: string
  secondProjectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-terminal-service-"))
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
      "2026-03-15T20:00:00Z",
      "2026-03-15T20:00:00Z",
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
      "2026-03-15T20:00:00Z",
      "2026-03-15T20:00:00Z",
    )
}

function createServices(
  databasePath: string,
  now: () => string,
): {
  persistenceService: SandboxPersistenceService
  projectService: ProjectService
  runtime: ReturnType<typeof bootstrapDatabase>
  sandboxService: SandboxService
  terminalService: TerminalService
} {
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const persistenceService = new SandboxPersistenceService(
    runtime.database,
    now,
  )
  const sandboxService = new SandboxService(persistenceService)
  const terminalService = new TerminalService(
    sandboxService,
    new RuntimeProfileService(runtime.database, persistenceService),
    new RuntimeSyncService(persistenceService, now),
  )

  sandboxService.setActivationSyncHandler((projectId, sandboxId) => {
    terminalService.syncRuntimeFilesForActivation(projectId, sandboxId)
  })

  return {
    runtime,
    projectService: new ProjectService(runtime.database),
    persistenceService,
    sandboxService,
    terminalService,
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

describe("TerminalService", () => {
  it("returns active sandbox plus default profile and unknown sync before first sync", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T20:00:00Z")
    const project = services.projectService.open({ path: firstProjectPath })

    const result = services.terminalService.getRuntimeProfile({
      project_id: project.id,
    })

    expect(result.sandbox.path).toBe(project.rootPath)
    expect(result.profile.runtimeFilePaths).toEqual([".env"])
    expect(result.sync.status).toBe("unknown")

    services.runtime.close()
  })

  it("copies .env into a thread sandbox and persists synced status", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T20:05:0${tick}Z`
    }
    const services = createServices(databasePath, now)
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=one\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })

    const result = services.terminalService.syncRuntimeFiles({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    expect(result.sync.status).toBe("synced")
    expect(result.sync.syncedFiles).toEqual([".env"])
    expect(result.sync.lastSyncedAt).toBeTruthy()
    expect(readFileSync(join(sandboxPath, ".env"), "utf8")).toBe(
      "API_KEY=one\n",
    )

    services.runtime.close()
  })

  it("forces a recopy even when the sandbox file is already current", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T20:10:0${tick}Z`
    }
    const services = createServices(databasePath, now)
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=force\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    services.sandboxService.setActive(project.id, threadSandbox.sandboxId)

    const first = services.terminalService.syncRuntimeFiles({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })
    const second = services.terminalService.syncRuntimeFiles({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
      force: true,
    })

    expect(first.sync.lastSyncedAt).toBeTruthy()
    expect(second.sync.lastSyncedAt).toBeTruthy()
    expect(second.sync.lastSyncedAt).not.toBe(first.sync.lastSyncedAt)
    expect(second.sync.details).toEqual(
      expect.objectContaining({
        copiedFiles: [".env"],
      }),
    )

    services.runtime.close()
  })

  it("treats a main checkout sync as satisfied without copying when .env exists", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T20:15:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=main\n")

    const result = services.terminalService.syncRuntimeFiles({
      project_id: project.id,
    })

    expect(result.sync.status).toBe("synced")
    expect(result.sync.syncedFiles).toEqual([".env"])
    expect(result.sync.details).toEqual(
      expect.objectContaining({
        copiedFiles: [],
      }),
    )

    services.runtime.close()
  })

  it("returns failed when the canonical source file is missing and preserves the active sandbox", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T20:20:0${tick}Z`
    }
    const services = createServices(databasePath, now)
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=two\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    services.sandboxService.setActive(project.id, threadSandbox.sandboxId)

    const first = services.terminalService.syncRuntimeFiles({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })
    unlinkSync(join(project.rootPath, ".env"))
    const failed = services.terminalService.syncRuntimeFiles({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    expect(first.sync.lastSyncedAt).toBeTruthy()
    expect(failed.sync.status).toBe("failed")
    expect(failed.sync.lastSyncedAt).toBe(first.sync.lastSyncedAt)
    expect(failed.sync.details).toEqual(
      expect.objectContaining({
        missingSourceFiles: [".env"],
      }),
    )
    expect(services.sandboxService.getActive(project.id).sandboxId).toBe(
      threadSandbox.sandboxId,
    )

    services.runtime.close()
  })

  it("returns failed with invalid path details instead of throwing", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T20:25:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    services.persistenceService.getRuntimeProfile(project.id)

    services.runtime.database
      .prepare(
        "UPDATE project_runtime_profiles SET runtime_file_paths_json = ? WHERE project_id = ?",
      )
      .run('["../.env"]', project.id)

    const result = services.terminalService.syncRuntimeFiles({
      project_id: project.id,
    })

    expect(result.sync.status).toBe("failed")
    expect(result.sync.details).toEqual(
      expect.objectContaining({
        invalidPaths: ["../.env"],
      }),
    )

    services.runtime.close()
  })

  it("marks a previously synced sandbox as stale when the target file disappears", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T20:30:0${tick}Z`
    }
    const services = createServices(databasePath, now)
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=three\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })

    services.terminalService.syncRuntimeFiles({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })
    unlinkSync(join(sandboxPath, ".env"))

    const result = services.terminalService.getRuntimeProfile({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    expect(result.sync.status).toBe("stale")
    expect(result.sync.details).toEqual(
      expect.objectContaining({
        staleFiles: [".env"],
      }),
    )

    services.runtime.close()
  })

  it("best-effort syncs runtime files on sandbox activation without changing the return shape", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T20:35:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=four\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })

    const activated = services.sandboxService.setActive(
      project.id,
      threadSandbox.sandboxId,
    )
    const sync = services.persistenceService.getRuntimeSync(
      threadSandbox.sandboxId,
    )

    expect(activated).toEqual(
      expect.objectContaining({
        sandboxId: threadSandbox.sandboxId,
      }),
    )
    expect(sync.status).toBe("synced")
    expect(readFileSync(join(sandboxPath, ".env"), "utf8")).toBe(
      "API_KEY=four\n",
    )

    services.runtime.close()
  })

  it("rejects an explicit sandbox id from another project", () => {
    const { databasePath, firstProjectPath, secondProjectPath } =
      createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T20:40:00Z")
    const firstProject = services.projectService.open({
      path: firstProjectPath,
    })
    const secondProject = services.projectService.open({
      path: secondProjectPath,
    })
    const secondSandbox = services.persistenceService.ensureMainCheckoutSandbox(
      secondProject.id,
    )

    expect(() =>
      services.terminalService.getRuntimeProfile({
        project_id: firstProject.id,
        sandbox_id: secondSandbox.sandboxId,
      }),
    ).toThrow(/Sandbox not found for project/)

    services.runtime.close()
  })
})
