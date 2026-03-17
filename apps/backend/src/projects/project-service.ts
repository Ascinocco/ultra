import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import type {
  ProjectId,
  ProjectLayoutState,
  ProjectOpenInput,
  ProjectSnapshot,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"

type ProjectRow = {
  id: string
  project_key: string
  name: string
  root_path: string
  git_root_path: string | null
  created_at: string
  updated_at: string
  last_opened_at: string
}

function readProjectRow(statementResult: unknown): ProjectRow | null {
  if (!statementResult || typeof statementResult !== "object") {
    return null
  }

  return statementResult as ProjectRow
}

function mapProjectRow(row: ProjectRow): ProjectSnapshot {
  return {
    id: row.id,
    key: row.project_key,
    name: row.name,
    rootPath: row.root_path,
    gitRootPath: row.git_root_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  }
}

function canonicalizeDirectoryPath(inputPath: string): string {
  let canonicalPath: string

  try {
    const resolvedPath = resolve(inputPath)
    canonicalPath = realpathSync(resolvedPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new IpcProtocolError(
      "invalid_request",
      `Project path could not be resolved: ${message}`,
    )
  }

  const stats = statSync(canonicalPath)

  if (!stats.isDirectory()) {
    throw new IpcProtocolError(
      "invalid_request",
      `Project path must be a directory: ${inputPath}`,
    )
  }

  return canonicalPath
}

function detectGitRoot(canonicalPath: string): string | null {
  try {
    const gitRoot = execFileSync(
      "git",
      ["-C", canonicalPath, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim()

    if (!gitRoot) {
      return null
    }

    return realpathSync(gitRoot)
  } catch {
    return null
  }
}

export class ProjectService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  open(input: ProjectOpenInput): ProjectSnapshot {
    const rootPath = canonicalizeDirectoryPath(input.path)
    const gitRootPath = detectGitRoot(rootPath)
    const projectKey = gitRootPath ?? rootPath
    const name = basename(projectKey)
    const timestamp = this.now()
    const sandboxPersistenceService = new SandboxPersistenceService(
      this.database,
      this.now,
    )
    const selectByKey = this.database.prepare(
      "SELECT id, project_key, name, root_path, git_root_path, created_at, updated_at, last_opened_at FROM projects WHERE project_key = ?",
    )
    const selectById = this.database.prepare(
      "SELECT id, project_key, name, root_path, git_root_path, created_at, updated_at, last_opened_at FROM projects WHERE id = ?",
    )
    const insertProject = this.database.prepare(`
      INSERT INTO projects (
        id,
        project_key,
        name,
        root_path,
        git_root_path,
        created_at,
        updated_at,
        last_opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateProject = this.database.prepare(`
      UPDATE projects
      SET
        name = ?,
        root_path = ?,
        git_root_path = ?,
        updated_at = ?,
        last_opened_at = ?
      WHERE id = ?
    `)
    const existingProject = readProjectRow(selectByKey.get(projectKey))
    const projectId = existingProject?.id ?? `proj_${randomUUID()}`

    this.database.exec("BEGIN")

    try {
      if (existingProject) {
        updateProject.run(
          name,
          rootPath,
          gitRootPath,
          timestamp,
          timestamp,
          existingProject.id,
        )
      } else {
        insertProject.run(
          projectId,
          projectKey,
          name,
          rootPath,
          gitRootPath,
          timestamp,
          timestamp,
          timestamp,
        )
      }

      this.database
        .prepare(
          `
            INSERT OR IGNORE INTO project_settings (
              project_id,
              default_branch_name,
              created_at,
              updated_at
            ) VALUES (?, NULL, ?, ?)
          `,
        )
        .run(projectId, timestamp, timestamp)

      this.database
        .prepare(
          `
            INSERT OR IGNORE INTO project_layout_state (
              project_id,
              current_page,
              right_top_collapsed,
              right_bottom_collapsed,
              selected_right_pane_tab,
              selected_bottom_pane_tab,
              active_chat_id,
              selected_thread_id,
              last_editor_target_id,
              updated_at
            ) VALUES (?, 'chat', 0, 0, NULL, NULL, NULL, NULL, NULL, ?)
          `,
        )
        .run(projectId, timestamp)

      sandboxPersistenceService.ensureMainCheckoutSandbox(projectId)
      sandboxPersistenceService.ensureActiveSandbox(projectId)

      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }

    const project = readProjectRow(selectById.get(projectId))

    if (!project) {
      throw new IpcProtocolError(
        "internal_error",
        "Project could not be loaded after open.",
      )
    }

    return mapProjectRow(project)
  }

  get(projectId: ProjectId): ProjectSnapshot {
    const project = readProjectRow(
      this.database
        .prepare(
          "SELECT id, project_key, name, root_path, git_root_path, created_at, updated_at, last_opened_at FROM projects WHERE id = ?",
        )
        .get(projectId),
    )

    if (!project) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }

    return mapProjectRow(project)
  }

  list(): { projects: ProjectSnapshot[] } {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            project_key,
            name,
            root_path,
            git_root_path,
            created_at,
            updated_at,
            last_opened_at
          FROM projects
          ORDER BY last_opened_at DESC, created_at DESC
        `,
      )
      .all() as ProjectRow[]

    return {
      projects: rows.map((row) => mapProjectRow(row)),
    }
  }

  getLayout(projectId: ProjectId): ProjectLayoutState {
    const row = this.database
      .prepare(
        `SELECT
          current_page,
          right_top_collapsed,
          selected_right_pane_tab,
          active_chat_id,
          selected_thread_id,
          last_editor_target_id,
          sidebar_collapsed,
          chat_thread_split_ratio
        FROM project_layout_state
        WHERE project_id = ?`,
      )
      .get(projectId) as
      | {
          current_page: string
          right_top_collapsed: number
          selected_right_pane_tab: string | null
          active_chat_id: string | null
          selected_thread_id: string | null
          last_editor_target_id: string | null
          sidebar_collapsed: number
          chat_thread_split_ratio: number | null
        }
      | undefined

    if (!row) {
      return {
        currentPage: "chat",
        rightTopCollapsed: false,
        selectedRightPaneTab: null,
        activeChatId: null,
        selectedThreadId: null,
        lastEditorTargetId: null,
        sidebarCollapsed: false,
        chatThreadSplitRatio: 0.55,
      }
    }

    return {
      currentPage: row.current_page as ProjectLayoutState["currentPage"],
      rightTopCollapsed: row.right_top_collapsed === 1,
      selectedRightPaneTab: row.selected_right_pane_tab,
      activeChatId: row.active_chat_id,
      selectedThreadId: row.selected_thread_id,
      lastEditorTargetId: row.last_editor_target_id,
      sidebarCollapsed: row.sidebar_collapsed === 1,
      chatThreadSplitRatio: row.chat_thread_split_ratio ?? 0.55,
    }
  }

  setLayout(projectId: ProjectId, layout: ProjectLayoutState): void {
    this.database
      .prepare(
        `INSERT INTO project_layout_state (
          project_id,
          current_page,
          right_top_collapsed,
          selected_right_pane_tab,
          active_chat_id,
          selected_thread_id,
          last_editor_target_id,
          sidebar_collapsed,
          chat_thread_split_ratio,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          current_page = excluded.current_page,
          right_top_collapsed = excluded.right_top_collapsed,
          selected_right_pane_tab = excluded.selected_right_pane_tab,
          active_chat_id = excluded.active_chat_id,
          selected_thread_id = excluded.selected_thread_id,
          last_editor_target_id = excluded.last_editor_target_id,
          sidebar_collapsed = excluded.sidebar_collapsed,
          chat_thread_split_ratio = excluded.chat_thread_split_ratio,
          updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        layout.currentPage,
        layout.rightTopCollapsed ? 1 : 0,
        layout.selectedRightPaneTab,
        layout.activeChatId,
        layout.selectedThreadId,
        layout.lastEditorTargetId,
        layout.sidebarCollapsed ? 1 : 0,
        layout.chatThreadSplitRatio,
        this.now(),
      )
  }
}
