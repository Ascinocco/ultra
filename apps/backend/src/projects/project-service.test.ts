import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "./project-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ultra-project-service-"))
  temporaryDirectories.push(directory)

  return {
    directory,
    databasePath: join(directory, "ultra.db"),
  }
}

function initGitRepo(directory: string): void {
  execFileSync("git", ["init", "-q"], { cwd: directory })
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("ProjectService", () => {
  it("opens a normal directory and creates a stable project row", () => {
    const { directory, databasePath } = createWorkspace()
    const projectDirectory = join(directory, "plain-project")
    mkdirSync(projectDirectory)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(
      runtime.database,
      () => "2026-03-14T12:00:00Z",
    )

    const firstProject = service.open({ path: projectDirectory })
    const secondProject = service.open({ path: projectDirectory })

    expect(firstProject.id).toBe(secondProject.id)
    expect(firstProject.key).toBe(firstProject.rootPath)

    const defaults = runtime.database
      .prepare(
        "SELECT current_page, right_top_collapsed, right_bottom_collapsed FROM project_layout_state WHERE project_id = ?",
      )
      .get(firstProject.id) as
      | {
          current_page: string
          right_top_collapsed: number
          right_bottom_collapsed: number
        }
      | undefined

    expect(defaults).toEqual({
      current_page: "chat",
      right_top_collapsed: 0,
      right_bottom_collapsed: 0,
    })

    const sandboxState = runtime.database
      .prepare(
        `
          SELECT
            project_layout_state.last_active_sandbox_id AS last_active_sandbox_id,
            sandbox_contexts.path AS sandbox_path,
            sandbox_contexts.display_name AS display_name,
            sandbox_contexts.sandbox_type AS sandbox_type
          FROM project_layout_state
          LEFT JOIN sandbox_contexts
            ON sandbox_contexts.sandbox_id = project_layout_state.last_active_sandbox_id
          WHERE project_layout_state.project_id = ?
        `,
      )
      .get(firstProject.id) as
      | {
          last_active_sandbox_id: string | null
          sandbox_path: string | null
          display_name: string | null
          sandbox_type: string | null
        }
      | undefined

    expect(sandboxState).toEqual({
      last_active_sandbox_id: expect.stringMatching(/^sandbox_/),
      sandbox_path: firstProject.rootPath,
      display_name: "Main",
      sandbox_type: "main_checkout",
    })

    runtime.close()
  })

  it("reuses project identity for nested folders inside one git repo", () => {
    const { directory, databasePath } = createWorkspace()
    const repoDirectory = join(directory, "repo")
    const nestedOne = join(repoDirectory, "packages/one")
    const nestedTwo = join(repoDirectory, "packages/two")
    mkdirSync(nestedOne, { recursive: true })
    mkdirSync(nestedTwo, { recursive: true })
    writeFileSync(join(repoDirectory, "README.md"), "ultra")
    initGitRepo(repoDirectory)

    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(
      runtime.database,
      () => "2026-03-14T12:00:00Z",
    )

    const firstProject = service.open({ path: nestedOne })
    const secondProject = service.open({ path: nestedTwo })

    expect(firstProject.id).toBe(secondProject.id)
    const canonicalRepoDirectory = realpathSync(repoDirectory)

    expect(firstProject.gitRootPath).toBe(canonicalRepoDirectory)
    expect(secondProject.key).toBe(canonicalRepoDirectory)

    runtime.close()
  })

  it("lists projects by most recent activity and gets by id", () => {
    const { directory, databasePath } = createWorkspace()
    const firstDirectory = join(directory, "alpha")
    const secondDirectory = join(directory, "beta")
    mkdirSync(firstDirectory)
    mkdirSync(secondDirectory)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    let tick = 0
    const service = new ProjectService(runtime.database, () => {
      tick += 1
      return `2026-03-14T12:00:0${tick}Z`
    })

    const firstProject = service.open({ path: firstDirectory })
    const secondProject = service.open({ path: secondDirectory })
    const projects = service.list()
    const fetched = service.get(firstProject.id)

    expect(projects.projects.map((project) => project.id)).toEqual([
      secondProject.id,
      firstProject.id,
    ])
    expect(fetched.id).toBe(firstProject.id)

    runtime.close()
  })

  it("getLayout returns default layout when no row exists", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(runtime.database)

    const layout = service.getLayout("proj_nonexistent")

    expect(layout).toEqual({
      currentPage: "chat",
      rightTopCollapsed: false,
      selectedRightPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
      sidebarCollapsed: false,
      chatThreadSplitRatio: 0.55,
    })

    runtime.close()
  })

  it("setLayout persists and getLayout retrieves layout state", () => {
    const { directory, databasePath } = createWorkspace()
    const projectDir = join(directory, "my-project")
    mkdirSync(projectDir)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )

    const project = service.open({ path: projectDir })
    service.setLayout(project.id, {
      currentPage: "editor",
      rightTopCollapsed: true,
      selectedRightPaneTab: "files",
      activeChatId: "chat_abc",
      selectedThreadId: null,
      lastEditorTargetId: "target_xyz",
      sidebarCollapsed: false,
      chatThreadSplitRatio: 0.55,
    })

    const layout = service.getLayout(project.id)

    expect(layout).toEqual({
      currentPage: "editor",
      rightTopCollapsed: true,
      selectedRightPaneTab: "files",
      activeChatId: "chat_abc",
      selectedThreadId: null,
      lastEditorTargetId: "target_xyz",
      sidebarCollapsed: false,
      chatThreadSplitRatio: 0.55,
    })

    runtime.close()
  })

  it("setLayout upserts — second call overwrites first", () => {
    const { directory, databasePath } = createWorkspace()
    const projectDir = join(directory, "upsert-project")
    mkdirSync(projectDir)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )

    const project = service.open({ path: projectDir })

    service.setLayout(project.id, {
      currentPage: "chat",
      rightTopCollapsed: false,
      selectedRightPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
      sidebarCollapsed: false,
      chatThreadSplitRatio: 0.55,
    })

    service.setLayout(project.id, {
      currentPage: "browser",
      rightTopCollapsed: true,
      selectedRightPaneTab: "timeline",
      activeChatId: "chat_123",
      selectedThreadId: "thread_456",
      lastEditorTargetId: "target_789",
      sidebarCollapsed: true,
      chatThreadSplitRatio: 0.7,
    })

    const layout = service.getLayout(project.id)

    expect(layout.currentPage).toBe("browser")
    expect(layout.rightTopCollapsed).toBe(true)
    expect(layout.selectedRightPaneTab).toBe("timeline")
    expect(layout.activeChatId).toBe("chat_123")
    expect(layout.selectedThreadId).toBe("thread_456")
    expect(layout.lastEditorTargetId).toBe("target_789")
    expect(layout.sidebarCollapsed).toBe(true)
    expect(layout.chatThreadSplitRatio).toBe(0.7)

    runtime.close()
  })

  it("setLayout preserves the hidden active sandbox linkage", () => {
    const { directory, databasePath } = createWorkspace()
    const projectDir = join(directory, "sandbox-layout-project")
    mkdirSync(projectDir)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )

    const project = service.open({ path: projectDir })
    const before = runtime.database
      .prepare(
        "SELECT last_active_sandbox_id FROM project_layout_state WHERE project_id = ?",
      )
      .get(project.id) as { last_active_sandbox_id: string | null } | undefined

    service.setLayout(project.id, {
      currentPage: "browser",
      rightTopCollapsed: false,
      selectedRightPaneTab: "timeline",
      activeChatId: "chat_123",
      selectedThreadId: "thread_456",
      lastEditorTargetId: "target_789",
      sidebarCollapsed: true,
      chatThreadSplitRatio: 0.6,
    })

    const after = runtime.database
      .prepare(
        "SELECT last_active_sandbox_id FROM project_layout_state WHERE project_id = ?",
      )
      .get(project.id) as { last_active_sandbox_id: string | null } | undefined

    expect(before?.last_active_sandbox_id).toMatch(/^sandbox_/)
    expect(after).toEqual(before)

    runtime.close()
  })

  it("getLayout converts SQLite integers to booleans for collapse fields", () => {
    const { directory, databasePath } = createWorkspace()
    const projectDir = join(directory, "bool-project")
    mkdirSync(projectDir)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )

    const project = service.open({ path: projectDir })
    const layout = service.getLayout(project.id)

    expect(layout.rightTopCollapsed).toBe(false)
    expect(layout.sidebarCollapsed).toBe(false)
    expect(typeof layout.rightTopCollapsed).toBe("boolean")
    expect(typeof layout.sidebarCollapsed).toBe("boolean")

    runtime.close()
  })

  it("setLayout rejects writes for non-existent project due to FK constraint", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(runtime.database)

    expect(() =>
      service.setLayout("proj_nonexistent", {
        currentPage: "chat",
        rightTopCollapsed: false,
        selectedRightPaneTab: null,
        activeChatId: null,
        selectedThreadId: null,
        lastEditorTargetId: null,
        sidebarCollapsed: false,
        chatThreadSplitRatio: 0.55,
      }),
    ).toThrow()

    runtime.close()
  })

  it("rejects missing paths, file paths, and unknown project ids", () => {
    const { directory, databasePath } = createWorkspace()
    const filePath = join(directory, "file.txt")
    writeFileSync(filePath, "not a directory")
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ProjectService(runtime.database)

    expect(() => service.open({ path: join(directory, "missing") })).toThrow(
      /ENOENT|no such file/i,
    )
    expect(() => service.open({ path: filePath })).toThrow(
      /must be a directory/,
    )
    expect(() => service.get("proj_missing")).toThrow(/Project not found/)

    runtime.close()
  })
})
