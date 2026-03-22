import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type {
  ProjectId,
  ProjectRuntimeProfileSnapshot,
  RuntimeProfileEnvVars,
  RuntimeSyncMode,
  SandboxContextSnapshot,
  SandboxRuntimeSyncDetails,
  SandboxRuntimeSyncSnapshot,
  SandboxRuntimeSyncStatus,
  SandboxType,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"

type SandboxContextRow = {
  sandbox_id: string
  project_id: string
  thread_id: string | null
  path: string
  display_name: string
  sandbox_type: SandboxType
  branch_name: string | null
  base_branch: string | null
  is_main_checkout: number
  created_at: string
  updated_at: string
  last_used_at: string | null
}

type ProjectRuntimeProfileRow = {
  project_id: string
  runtime_file_paths_json: string
  env_vars_json: string
  created_at: string
  updated_at: string
}

type SandboxRuntimeSyncRow = {
  sync_id: string
  sandbox_id: string
  project_id: string
  sync_mode: RuntimeSyncMode
  status: SandboxRuntimeSyncStatus
  synced_files_json: string
  last_synced_at: string | null
  details_json: string | null
  created_at: string
  updated_at: string
}

export type UpsertRuntimeSyncInput = {
  sandboxId: string
  syncMode?: RuntimeSyncMode
  status: SandboxRuntimeSyncStatus
  syncedFiles?: string[]
  lastSyncedAt?: string | null
  details?: SandboxRuntimeSyncDetails | null
}

export type UpsertThreadSandboxInput = {
  projectId: ProjectId
  threadId: string
  path: string
  displayName: string
  branchName?: string | null
  baseBranch?: string | null
  lastUsedAt?: string | null
}

/**
 * Derive a display name from a branch name or worktree path.
 * "feature/auth-flow" → "auth-flow"
 * "fix/login-bug" → "login-bug"
 * No branch → directory name from path
 */
function deriveWorktreeDisplayName(
  branchName: string | null,
  path: string,
): string {
  if (branchName) {
    const lastSlash = branchName.lastIndexOf("/")
    return lastSlash >= 0 ? branchName.slice(lastSlash + 1) : branchName
  }
  // Fall back to directory name
  const segments = path.replace(/\/+$/u, "").split("/")
  return segments[segments.length - 1] ?? "worktree"
}

function readSandboxContextRow(result: unknown): SandboxContextRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as SandboxContextRow
}

function readProjectRuntimeProfileRow(
  result: unknown,
): ProjectRuntimeProfileRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ProjectRuntimeProfileRow
}

function readSandboxRuntimeSyncRow(
  result: unknown,
): SandboxRuntimeSyncRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as SandboxRuntimeSyncRow
}

function parseRuntimeFilePaths(runtimeFilePathsJson: string): string[] {
  const parsed = JSON.parse(runtimeFilePathsJson) as unknown

  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string")
  ) {
    throw new Error("Runtime file paths JSON must decode to a string array.")
  }

  return parsed
}

function parseEnvVars(envVarsJson: string): RuntimeProfileEnvVars {
  const parsed = JSON.parse(envVarsJson) as unknown

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Runtime env vars JSON must decode to an object.")
  }

  return parsed as RuntimeProfileEnvVars
}

function parseSyncedFiles(syncedFilesJson: string): string[] {
  const parsed = JSON.parse(syncedFilesJson) as unknown

  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string")
  ) {
    throw new Error("Synced files JSON must decode to a string array.")
  }

  return parsed
}

function parseSyncDetails(
  detailsJson: string | null,
): SandboxRuntimeSyncDetails | null {
  if (!detailsJson) {
    return null
  }

  const parsed = JSON.parse(detailsJson) as unknown

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Runtime sync details JSON must decode to an object.")
  }

  return parsed as SandboxRuntimeSyncDetails
}

function mapSandboxContextRow(row: SandboxContextRow): SandboxContextSnapshot {
  return {
    sandboxId: row.sandbox_id,
    projectId: row.project_id,
    threadId: row.thread_id,
    path: row.path,
    displayName: row.display_name,
    sandboxType: row.sandbox_type,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    isMainCheckout: row.is_main_checkout === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  }
}

function mapProjectRuntimeProfileRow(
  row: ProjectRuntimeProfileRow,
): ProjectRuntimeProfileSnapshot {
  return {
    projectId: row.project_id,
    runtimeFilePaths: parseRuntimeFilePaths(row.runtime_file_paths_json),
    envVars: parseEnvVars(row.env_vars_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSandboxRuntimeSyncRow(
  row: SandboxRuntimeSyncRow,
): SandboxRuntimeSyncSnapshot {
  return {
    syncId: row.sync_id,
    sandboxId: row.sandbox_id,
    projectId: row.project_id,
    syncMode: row.sync_mode,
    status: row.status,
    syncedFiles: parseSyncedFiles(row.synced_files_json),
    lastSyncedAt: row.last_synced_at,
    details: parseSyncDetails(row.details_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SandboxPersistenceService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  ensureMainCheckoutSandbox(projectId: ProjectId): SandboxContextSnapshot {
    const rootPath = this.getProjectRootPath(projectId)
    const existing =
      this.getMainCheckoutSandboxRow(projectId) ??
      this.getSandboxByPathRow(rootPath)
    const timestamp = this.now()

    if (existing) {
      this.database
        .prepare(
          `
            UPDATE sandbox_contexts
            SET
              project_id = ?,
              thread_id = NULL,
              path = ?,
              display_name = 'Main',
              sandbox_type = 'main_checkout',
              branch_name = NULL,
              base_branch = NULL,
              is_main_checkout = 1,
              updated_at = ?
            WHERE sandbox_id = ?
          `,
        )
        .run(projectId, rootPath, timestamp, existing.sandbox_id)

      return this.getSandboxSnapshot(existing.sandbox_id)
    }

    const sandboxId = `sandbox_${randomUUID()}`

    this.database
      .prepare(
        `
          INSERT INTO sandbox_contexts (
            sandbox_id,
            project_id,
            thread_id,
            path,
            display_name,
            sandbox_type,
            branch_name,
            base_branch,
            is_main_checkout,
            created_at,
            updated_at,
            last_used_at
          ) VALUES (?, ?, NULL, ?, 'Main', 'main_checkout', NULL, NULL, 1, ?, ?, ?)
        `,
      )
      .run(sandboxId, projectId, rootPath, timestamp, timestamp, timestamp)

    return this.getSandboxSnapshot(sandboxId)
  }

  ensureActiveSandbox(projectId: ProjectId): SandboxContextSnapshot {
    const mainSandbox = this.ensureMainCheckoutSandbox(projectId)
    const storedSandboxId = this.getStoredActiveSandboxId(projectId)

    if (storedSandboxId) {
      const storedSandbox = this.getSandboxForProject(
        projectId,
        storedSandboxId,
      )

      if (storedSandbox) {
        return mapSandboxContextRow(storedSandbox)
      }
    }

    this.persistActiveSandbox(projectId, mainSandbox.sandboxId)

    return mainSandbox
  }

  listSandboxes(projectId: ProjectId): SandboxContextSnapshot[] {
    this.ensureMainCheckoutSandbox(projectId)

    const rows = this.database
      .prepare(
        `
          SELECT
            sandbox_id,
            project_id,
            thread_id,
            path,
            display_name,
            sandbox_type,
            branch_name,
            base_branch,
            is_main_checkout,
            created_at,
            updated_at,
            last_used_at
          FROM sandbox_contexts
          WHERE project_id = ?
          ORDER BY is_main_checkout DESC, last_used_at DESC, created_at DESC
        `,
      )
      .all(projectId) as SandboxContextRow[]

    return rows.map((row) => mapSandboxContextRow(row))
  }

  getActiveSandbox(projectId: ProjectId): SandboxContextSnapshot {
    const mainSandbox = this.ensureMainCheckoutSandbox(projectId)
    const storedSandboxId = this.getStoredActiveSandboxId(projectId)

    if (!storedSandboxId) {
      return mainSandbox
    }

    const storedSandbox = this.getSandboxForProject(projectId, storedSandboxId)

    if (!storedSandbox) {
      return mainSandbox
    }

    return mapSandboxContextRow(storedSandbox)
  }

  findThreadSandbox(
    projectId: ProjectId,
    threadId: string,
  ): SandboxContextSnapshot | null {
    this.assertProjectExists(projectId)
    this.assertThreadBelongsToProject(projectId, threadId)

    const sandbox = readSandboxContextRow(
      this.database
        .prepare(
          `
            SELECT
              sandbox_id,
              project_id,
              thread_id,
              path,
              display_name,
              sandbox_type,
              branch_name,
              base_branch,
              is_main_checkout,
              created_at,
              updated_at,
              last_used_at
            FROM sandbox_contexts
            WHERE project_id = ? AND thread_id = ?
          `,
        )
        .get(projectId, threadId),
    )

    return sandbox ? mapSandboxContextRow(sandbox) : null
  }

  getSandbox(projectId: ProjectId, sandboxId: string): SandboxContextSnapshot {
    this.assertProjectExists(projectId)
    const sandbox = this.getSandboxForProject(projectId, sandboxId)

    if (!sandbox) {
      throw new IpcProtocolError(
        "not_found",
        `Sandbox not found for project: ${sandboxId}`,
      )
    }

    return mapSandboxContextRow(sandbox)
  }

  setActiveSandbox(
    projectId: ProjectId,
    sandboxId: string,
  ): SandboxContextSnapshot {
    this.assertProjectExists(projectId)

    const sandbox = this.getSandboxForProject(projectId, sandboxId)

    if (!sandbox) {
      throw new IpcProtocolError(
        "not_found",
        `Sandbox not found for project: ${sandboxId}`,
      )
    }

    const timestamp = this.now()

    this.persistActiveSandbox(projectId, sandboxId)
    this.database
      .prepare(
        `
          UPDATE sandbox_contexts
          SET last_used_at = ?, updated_at = ?
          WHERE sandbox_id = ?
        `,
      )
      .run(timestamp, timestamp, sandboxId)

    return this.getSandboxSnapshot(sandboxId)
  }

  getRuntimeProfile(projectId: ProjectId): ProjectRuntimeProfileSnapshot {
    this.assertProjectExists(projectId)
    const existing = readProjectRuntimeProfileRow(
      this.database
        .prepare(
          `
            SELECT
              project_id,
              runtime_file_paths_json,
              env_vars_json,
              created_at,
              updated_at
            FROM project_runtime_profiles
            WHERE project_id = ?
          `,
        )
        .get(projectId),
    )

    if (existing) {
      return mapProjectRuntimeProfileRow(existing)
    }

    const timestamp = this.now()

    this.database
      .prepare(
        `
          INSERT INTO project_runtime_profiles (
            project_id,
            runtime_file_paths_json,
            env_vars_json,
            created_at,
            updated_at
          ) VALUES (?, '[".env", ".ultra"]', '{}', ?, ?)
        `,
      )
      .run(projectId, timestamp, timestamp)

    return this.getRuntimeProfile(projectId)
  }

  updateRuntimeFilePaths(
    projectId: ProjectId,
    runtimeFilePaths: string[],
  ): ProjectRuntimeProfileSnapshot {
    // Ensure the profile exists
    this.getRuntimeProfile(projectId)
    const timestamp = this.now()

    this.database
      .prepare(
        `
          UPDATE project_runtime_profiles
          SET runtime_file_paths_json = ?, updated_at = ?
          WHERE project_id = ?
        `,
      )
      .run(JSON.stringify(runtimeFilePaths), timestamp, projectId)

    return this.getRuntimeProfile(projectId)
  }

  getRuntimeSync(sandboxId: string): SandboxRuntimeSyncSnapshot {
    const sandbox = this.getSandboxRowOrThrow(sandboxId)
    const existing = this.getPersistedRuntimeSync(sandboxId)

    if (existing) {
      return existing
    }

    return {
      syncId: `sync_unknown_${sandbox.sandbox_id}`,
      sandboxId: sandbox.sandbox_id,
      projectId: sandbox.project_id,
      syncMode: "managed_copy",
      status: "unknown",
      syncedFiles: [],
      lastSyncedAt: null,
      details: null,
      createdAt: sandbox.created_at,
      updatedAt: sandbox.updated_at,
    }
  }

  upsertRuntimeSync(input: UpsertRuntimeSyncInput): SandboxRuntimeSyncSnapshot {
    const sandbox = this.getSandboxRowOrThrow(input.sandboxId)
    const existing = readSandboxRuntimeSyncRow(
      this.database
        .prepare(
          `
            SELECT
              sync_id,
              sandbox_id,
              project_id,
              sync_mode,
              status,
              synced_files_json,
              last_synced_at,
              details_json,
              created_at,
              updated_at
            FROM sandbox_runtime_syncs
            WHERE sandbox_id = ?
          `,
        )
        .get(input.sandboxId),
    )
    const timestamp = this.now()

    if (existing) {
      this.database
        .prepare(
          `
            UPDATE sandbox_runtime_syncs
            SET
              project_id = ?,
              sync_mode = ?,
              status = ?,
              synced_files_json = ?,
              last_synced_at = ?,
              details_json = ?,
              updated_at = ?
            WHERE sandbox_id = ?
          `,
        )
        .run(
          sandbox.project_id,
          input.syncMode ?? existing.sync_mode,
          input.status,
          JSON.stringify(
            input.syncedFiles ?? parseSyncedFiles(existing.synced_files_json),
          ),
          input.lastSyncedAt ?? existing.last_synced_at,
          input.details ? JSON.stringify(input.details) : null,
          timestamp,
          input.sandboxId,
        )
    } else {
      this.database
        .prepare(
          `
            INSERT INTO sandbox_runtime_syncs (
              sync_id,
              sandbox_id,
              project_id,
              sync_mode,
              status,
              synced_files_json,
              last_synced_at,
              details_json,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          `sync_${randomUUID()}`,
          input.sandboxId,
          sandbox.project_id,
          input.syncMode ?? "managed_copy",
          input.status,
          JSON.stringify(input.syncedFiles ?? []),
          input.lastSyncedAt ?? null,
          input.details ? JSON.stringify(input.details) : null,
          timestamp,
          timestamp,
        )
    }

    return this.getRuntimeSync(input.sandboxId)
  }

  getPersistedRuntimeSync(
    sandboxId: string,
  ): SandboxRuntimeSyncSnapshot | null {
    this.getSandboxRowOrThrow(sandboxId)

    const existing = readSandboxRuntimeSyncRow(
      this.database
        .prepare(
          `
            SELECT
              sync_id,
              sandbox_id,
              project_id,
              sync_mode,
              status,
              synced_files_json,
              last_synced_at,
              details_json,
              created_at,
              updated_at
            FROM sandbox_runtime_syncs
            WHERE sandbox_id = ?
          `,
        )
        .get(sandboxId),
    )

    return existing ? mapSandboxRuntimeSyncRow(existing) : null
  }

  upsertThreadSandbox(input: UpsertThreadSandboxInput): SandboxContextSnapshot {
    this.assertThreadBelongsToProject(input.projectId, input.threadId)
    const existing = readSandboxContextRow(
      this.database
        .prepare(
          `
            SELECT
              sandbox_id,
              project_id,
              thread_id,
              path,
              display_name,
              sandbox_type,
              branch_name,
              base_branch,
              is_main_checkout,
              created_at,
              updated_at,
              last_used_at
            FROM sandbox_contexts
            WHERE project_id = ? AND thread_id = ?
          `,
        )
        .get(input.projectId, input.threadId),
    )
    const timestamp = this.now()

    if (existing) {
      this.database
        .prepare(
          `
            UPDATE sandbox_contexts
            SET
              path = ?,
              display_name = ?,
              sandbox_type = 'thread_sandbox',
              branch_name = ?,
              base_branch = ?,
              is_main_checkout = 0,
              updated_at = ?,
              last_used_at = ?
            WHERE sandbox_id = ?
          `,
        )
        .run(
          input.path,
          input.displayName,
          input.branchName ?? null,
          input.baseBranch ?? null,
          timestamp,
          input.lastUsedAt ?? timestamp,
          existing.sandbox_id,
        )

      return this.getSandboxSnapshot(existing.sandbox_id)
    }

    const sandboxId = `sandbox_${randomUUID()}`

    this.database
      .prepare(
        `
          INSERT INTO sandbox_contexts (
            sandbox_id,
            project_id,
            thread_id,
            path,
            display_name,
            sandbox_type,
            branch_name,
            base_branch,
            is_main_checkout,
            created_at,
            updated_at,
            last_used_at
          ) VALUES (?, ?, ?, ?, ?, 'thread_sandbox', ?, ?, 0, ?, ?, ?)
        `,
      )
      .run(
        sandboxId,
        input.projectId,
        input.threadId,
        input.path,
        input.displayName,
        input.branchName ?? null,
        input.baseBranch ?? null,
        timestamp,
        timestamp,
        input.lastUsedAt ?? timestamp,
      )

    return this.getSandboxSnapshot(sandboxId)
  }

  upsertUserWorktree(input: {
    projectId: ProjectId
    path: string
    branchName: string | null
  }): SandboxContextSnapshot {
    const existing = this.getSandboxByPathRow(input.path)
    const timestamp = this.now()
    const displayName = deriveWorktreeDisplayName(input.branchName, input.path)

    if (existing) {
      this.database
        .prepare(
          `
            UPDATE sandbox_contexts
            SET
              project_id = ?,
              display_name = ?,
              sandbox_type = 'user_worktree',
              branch_name = ?,
              is_main_checkout = 0,
              updated_at = ?
            WHERE sandbox_id = ?
          `,
        )
        .run(
          input.projectId,
          displayName,
          input.branchName,
          timestamp,
          existing.sandbox_id,
        )

      return this.getSandboxSnapshot(existing.sandbox_id)
    }

    const sandboxId = `sandbox_${randomUUID()}`

    this.database
      .prepare(
        `
          INSERT INTO sandbox_contexts (
            sandbox_id,
            project_id,
            thread_id,
            path,
            display_name,
            sandbox_type,
            branch_name,
            base_branch,
            is_main_checkout,
            created_at,
            updated_at,
            last_used_at
          ) VALUES (?, ?, NULL, ?, ?, 'user_worktree', ?, NULL, 0, ?, ?, NULL)
        `,
      )
      .run(
        sandboxId,
        input.projectId,
        input.path,
        displayName,
        input.branchName,
        timestamp,
        timestamp,
      )

    return this.getSandboxSnapshot(sandboxId)
  }

  removeStaleWorktrees(
    projectId: ProjectId,
    activePaths: Set<string>,
  ): number {
    const userWorktrees = this.database
      .prepare(
        `
          SELECT sandbox_id, path
          FROM sandbox_contexts
          WHERE project_id = ? AND sandbox_type = 'user_worktree'
        `,
      )
      .all(projectId) as Array<{ sandbox_id: string; path: string }>

    let removed = 0
    for (const row of userWorktrees) {
      if (!activePaths.has(row.path)) {
        this.database
          .prepare("DELETE FROM sandbox_contexts WHERE sandbox_id = ?")
          .run(row.sandbox_id)
        removed++
      }
    }

    return removed
  }

  private persistActiveSandbox(projectId: ProjectId, sandboxId: string): void {
    const timestamp = this.now()

    this.ensureProjectLayoutRow(projectId)
    this.database
      .prepare(
        `
          UPDATE project_layout_state
          SET last_active_sandbox_id = ?, updated_at = ?
          WHERE project_id = ?
        `,
      )
      .run(sandboxId, timestamp, projectId)
  }

  private ensureProjectLayoutRow(projectId: ProjectId): void {
    const timestamp = this.now()

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
  }

  private getProjectRootPath(projectId: ProjectId): string {
    const row = this.database
      .prepare("SELECT root_path FROM projects WHERE id = ?")
      .get(projectId) as { root_path: string } | undefined

    if (!row) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }

    return row.root_path
  }

  private getStoredActiveSandboxId(projectId: ProjectId): string | null {
    this.assertProjectExists(projectId)
    const row = this.database
      .prepare(
        "SELECT last_active_sandbox_id FROM project_layout_state WHERE project_id = ?",
      )
      .get(projectId) as { last_active_sandbox_id: string | null } | undefined

    return row?.last_active_sandbox_id ?? null
  }

  private getMainCheckoutSandboxRow(
    projectId: ProjectId,
  ): SandboxContextRow | null {
    return readSandboxContextRow(
      this.database
        .prepare(
          `
            SELECT
              sandbox_id,
              project_id,
              thread_id,
              path,
              display_name,
              sandbox_type,
              branch_name,
              base_branch,
              is_main_checkout,
              created_at,
              updated_at,
              last_used_at
            FROM sandbox_contexts
            WHERE project_id = ? AND is_main_checkout = 1
          `,
        )
        .get(projectId),
    )
  }

  private getSandboxByPathRow(path: string): SandboxContextRow | null {
    return readSandboxContextRow(
      this.database
        .prepare(
          `
            SELECT
              sandbox_id,
              project_id,
              thread_id,
              path,
              display_name,
              sandbox_type,
              branch_name,
              base_branch,
              is_main_checkout,
              created_at,
              updated_at,
              last_used_at
            FROM sandbox_contexts
            WHERE path = ?
          `,
        )
        .get(path),
    )
  }

  private getSandboxForProject(
    projectId: ProjectId,
    sandboxId: string,
  ): SandboxContextRow | null {
    return readSandboxContextRow(
      this.database
        .prepare(
          `
            SELECT
              sandbox_id,
              project_id,
              thread_id,
              path,
              display_name,
              sandbox_type,
              branch_name,
              base_branch,
              is_main_checkout,
              created_at,
              updated_at,
              last_used_at
            FROM sandbox_contexts
            WHERE project_id = ? AND sandbox_id = ?
          `,
        )
        .get(projectId, sandboxId),
    )
  }

  private getSandboxRowOrThrow(sandboxId: string): SandboxContextRow {
    const sandbox = readSandboxContextRow(
      this.database
        .prepare(
          `
            SELECT
              sandbox_id,
              project_id,
              thread_id,
              path,
              display_name,
              sandbox_type,
              branch_name,
              base_branch,
              is_main_checkout,
              created_at,
              updated_at,
              last_used_at
            FROM sandbox_contexts
            WHERE sandbox_id = ?
          `,
        )
        .get(sandboxId),
    )

    if (!sandbox) {
      throw new IpcProtocolError("not_found", `Sandbox not found: ${sandboxId}`)
    }

    return sandbox
  }

  private getSandboxSnapshot(sandboxId: string): SandboxContextSnapshot {
    return mapSandboxContextRow(this.getSandboxRowOrThrow(sandboxId))
  }

  private assertProjectExists(projectId: ProjectId): void {
    const result = this.database
      .prepare("SELECT 1 FROM projects WHERE id = ?")
      .get(projectId) as { 1: number } | undefined

    if (!result) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }
  }

  private assertThreadBelongsToProject(
    projectId: ProjectId,
    threadId: string,
  ): void {
    const result = this.database
      .prepare("SELECT 1 FROM threads WHERE id = ? AND project_id = ?")
      .get(threadId, projectId) as { 1: number } | undefined

    if (!result) {
      throw new IpcProtocolError(
        "not_found",
        `Thread not found for project: ${threadId}`,
      )
    }
  }
}
