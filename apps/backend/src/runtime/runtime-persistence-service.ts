import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type {
  ProjectId,
  ProjectRuntimeHealthSummary,
  ProjectRuntimeSnapshot,
  RuntimeComponentHealthStatus,
  RuntimeComponentScope,
  RuntimeComponentSnapshot,
  RuntimeComponentType,
  RuntimeDetails,
  RuntimeHealthCheckSnapshot,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"

type ProjectRuntimeRow = {
  project_runtime_id: string
  project_id: string
  coordinator_id: string | null
  coordinator_instance_id: string | null
  status: string
  started_at: string | null
  last_heartbeat_at: string | null
  restart_count: number
  created_at: string
  updated_at: string
}

type RuntimeComponentRow = {
  component_id: string
  project_id: string | null
  component_type: RuntimeComponentType
  scope: RuntimeComponentScope
  process_id: number | null
  status: RuntimeComponentHealthStatus
  started_at: string | null
  last_heartbeat_at: string | null
  restart_count: number
  reason: string | null
  details_json: string | null
  created_at: string
  updated_at: string
}

type RuntimeHealthCheckRow = {
  health_check_id: string
  component_id: string
  project_id: string | null
  status: RuntimeComponentHealthStatus
  checked_at: string
  last_heartbeat_at: string | null
  reason: string | null
  details_json: string | null
}

export type UpsertProjectRuntimeInput = {
  projectId: ProjectId
  coordinatorId?: string | null
  coordinatorInstanceId?: string | null
  status: string
  startedAt?: string | null
  lastHeartbeatAt?: string | null
  restartCount?: number
}

export type UpsertRuntimeComponentInput = {
  componentId?: string
  projectId?: ProjectId | null
  componentType: RuntimeComponentType
  scope: RuntimeComponentScope
  processId?: number | null
  status: RuntimeComponentHealthStatus
  startedAt?: string | null
  lastHeartbeatAt?: string | null
  restartCount?: number
  reason?: string | null
  details?: RuntimeDetails | null
}

export type RecordRuntimeHealthCheckInput = {
  componentId: string
  projectId?: ProjectId | null
  status: RuntimeComponentHealthStatus
  checkedAt?: string
  lastHeartbeatAt?: string | null
  reason?: string | null
  details?: RuntimeDetails | null
}

function readProjectRuntimeRow(
  statementResult: unknown,
): ProjectRuntimeRow | null {
  if (!statementResult || typeof statementResult !== "object") {
    return null
  }

  return statementResult as ProjectRuntimeRow
}

function readRuntimeComponentRow(
  statementResult: unknown,
): RuntimeComponentRow | null {
  if (!statementResult || typeof statementResult !== "object") {
    return null
  }

  return statementResult as RuntimeComponentRow
}

function parseDetails(detailsJson: string | null): RuntimeDetails | null {
  if (!detailsJson) {
    return null
  }

  const parsed = JSON.parse(detailsJson) as unknown

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Runtime details JSON must decode to an object.")
  }

  return parsed as RuntimeDetails
}

function stringifyDetails(
  details: RuntimeDetails | null | undefined,
): string | null {
  return details ? JSON.stringify(details) : null
}

function mapProjectRuntimeRow(row: ProjectRuntimeRow): ProjectRuntimeSnapshot {
  return {
    projectRuntimeId: row.project_runtime_id,
    projectId: row.project_id,
    coordinatorId: row.coordinator_id,
    coordinatorInstanceId: row.coordinator_instance_id,
    status: row.status,
    startedAt: row.started_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    restartCount: row.restart_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRuntimeComponentRow(
  row: RuntimeComponentRow,
): RuntimeComponentSnapshot {
  return {
    componentId: row.component_id,
    projectId: row.project_id,
    componentType: row.component_type,
    scope: row.scope,
    processId: row.process_id,
    status: row.status,
    startedAt: row.started_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    restartCount: row.restart_count,
    reason: row.reason,
    details: parseDetails(row.details_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRuntimeHealthCheckRow(
  row: RuntimeHealthCheckRow,
): RuntimeHealthCheckSnapshot {
  return {
    healthCheckId: row.health_check_id,
    componentId: row.component_id,
    projectId: row.project_id,
    status: row.status,
    checkedAt: row.checked_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    reason: row.reason,
    details: parseDetails(row.details_json),
  }
}

export class RuntimePersistenceService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  ensureProjectRuntime(projectId: ProjectId): ProjectRuntimeSnapshot {
    this.assertProjectExists(projectId)
    const existing = this.getProjectRuntimeSnapshotOrNull(projectId)

    if (existing) {
      return existing
    }

    const timestamp = this.now()
    const projectRuntimeId = `project_runtime_${randomUUID()}`

    this.database
      .prepare(
        `
          INSERT INTO project_runtimes (
            project_runtime_id,
            project_id,
            coordinator_id,
            coordinator_instance_id,
            status,
            started_at,
            last_heartbeat_at,
            restart_count,
            created_at,
            updated_at
          ) VALUES (?, ?, NULL, NULL, 'idle', NULL, NULL, 0, ?, ?)
        `,
      )
      .run(projectRuntimeId, projectId, timestamp, timestamp)

    return this.getProjectRuntimeSnapshot(projectId)
  }

  upsertProjectRuntime(
    input: UpsertProjectRuntimeInput,
  ): ProjectRuntimeSnapshot {
    const existing = this.ensureProjectRuntime(input.projectId)
    const timestamp = this.now()

    this.database
      .prepare(
        `
          UPDATE project_runtimes
          SET
            coordinator_id = ?,
            coordinator_instance_id = ?,
            status = ?,
            started_at = ?,
            last_heartbeat_at = ?,
            restart_count = ?,
            updated_at = ?
          WHERE project_id = ?
        `,
      )
      .run(
        input.coordinatorId ?? existing.coordinatorId,
        input.coordinatorInstanceId ?? existing.coordinatorInstanceId,
        input.status,
        input.startedAt ?? existing.startedAt,
        input.lastHeartbeatAt ?? existing.lastHeartbeatAt,
        input.restartCount ?? existing.restartCount,
        timestamp,
        input.projectId,
      )

    return this.getProjectRuntimeSnapshot(input.projectId)
  }

  upsertRuntimeComponent(
    input: UpsertRuntimeComponentInput,
  ): RuntimeComponentSnapshot {
    const timestamp = this.now()

    if (input.scope === "project" && !input.projectId) {
      throw new IpcProtocolError(
        "invalid_request",
        "Project-scoped runtime components require a project id.",
      )
    }

    if (input.projectId) {
      this.assertProjectExists(input.projectId)
    }

    const existing = input.componentId
      ? this.getRuntimeComponentSnapshotOrNull(input.componentId)
      : null
    const componentId = input.componentId ?? `runtime_component_${randomUUID()}`

    if (existing) {
      this.database
        .prepare(
          `
            UPDATE runtime_components
            SET
              project_id = ?,
              component_type = ?,
              scope = ?,
              process_id = ?,
              status = ?,
              started_at = ?,
              last_heartbeat_at = ?,
              restart_count = ?,
              reason = ?,
              details_json = ?,
              updated_at = ?
            WHERE component_id = ?
          `,
        )
        .run(
          input.projectId ?? existing.projectId,
          input.componentType,
          input.scope,
          input.processId ?? existing.processId,
          input.status,
          input.startedAt ?? existing.startedAt,
          input.lastHeartbeatAt ?? existing.lastHeartbeatAt,
          input.restartCount ?? existing.restartCount,
          input.reason ?? existing.reason,
          stringifyDetails(input.details ?? existing.details),
          timestamp,
          componentId,
        )
    } else {
      this.database
        .prepare(
          `
            INSERT INTO runtime_components (
              component_id,
              project_id,
              component_type,
              scope,
              process_id,
              status,
              started_at,
              last_heartbeat_at,
              restart_count,
              reason,
              details_json,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          componentId,
          input.projectId ?? null,
          input.componentType,
          input.scope,
          input.processId ?? null,
          input.status,
          input.startedAt ?? null,
          input.lastHeartbeatAt ?? null,
          input.restartCount ?? 0,
          input.reason ?? null,
          stringifyDetails(input.details),
          timestamp,
          timestamp,
        )
    }

    return this.getRuntimeComponentSnapshot(componentId)
  }

  recordRuntimeHealthCheck(
    input: RecordRuntimeHealthCheckInput,
  ): RuntimeHealthCheckSnapshot {
    const component = this.getRuntimeComponentSnapshot(input.componentId)
    const checkedAt = input.checkedAt ?? this.now()
    const healthCheckId = `runtime_health_${randomUUID()}`
    const projectId = input.projectId ?? component.projectId

    if (projectId) {
      this.assertProjectExists(projectId)
    }

    this.database.exec("BEGIN")

    try {
      this.database
        .prepare(
          `
            INSERT INTO runtime_health_checks (
              health_check_id,
              component_id,
              project_id,
              status,
              checked_at,
              last_heartbeat_at,
              reason,
              details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          healthCheckId,
          input.componentId,
          projectId ?? null,
          input.status,
          checkedAt,
          input.lastHeartbeatAt ?? component.lastHeartbeatAt,
          input.reason ?? component.reason,
          stringifyDetails(input.details ?? component.details),
        )

      this.database
        .prepare(
          `
            UPDATE runtime_components
            SET
              status = ?,
              last_heartbeat_at = ?,
              reason = ?,
              details_json = ?,
              updated_at = ?
            WHERE component_id = ?
          `,
        )
        .run(
          input.status,
          input.lastHeartbeatAt ?? component.lastHeartbeatAt,
          input.reason ?? component.reason,
          stringifyDetails(input.details ?? component.details),
          checkedAt,
          input.componentId,
        )

      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }

    const row = this.database
      .prepare(
        `
          SELECT
            health_check_id,
            component_id,
            project_id,
            status,
            checked_at,
            last_heartbeat_at,
            reason,
            details_json
          FROM runtime_health_checks
          WHERE health_check_id = ?
        `,
      )
      .get(healthCheckId) as RuntimeHealthCheckRow | undefined

    if (!row) {
      throw new IpcProtocolError(
        "internal_error",
        "Runtime health check could not be loaded after write.",
      )
    }

    return mapRuntimeHealthCheckRow(row)
  }

  getRuntimeComponentSnapshot(componentId: string): RuntimeComponentSnapshot {
    return this.getRuntimeComponentSnapshotOrThrow(componentId)
  }

  getProjectRuntimeSnapshot(projectId: ProjectId): ProjectRuntimeSnapshot {
    const runtime = this.getProjectRuntimeSnapshotOrNull(projectId)

    if (!runtime) {
      throw new IpcProtocolError(
        "not_found",
        `Project runtime not found for project: ${projectId}`,
      )
    }

    return runtime
  }

  listAllProjectRuntimeSnapshots(): ProjectRuntimeSnapshot[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            project_runtime_id,
            project_id,
            coordinator_id,
            coordinator_instance_id,
            status,
            started_at,
            last_heartbeat_at,
            restart_count,
            created_at,
            updated_at
          FROM project_runtimes
          ORDER BY created_at ASC
        `,
      )
      .all() as ProjectRuntimeRow[]

    return rows.map(mapProjectRuntimeRow)
  }

  listProjectRuntimeComponents(
    projectId: ProjectId,
  ): RuntimeComponentSnapshot[] {
    this.assertProjectExists(projectId)

    const rows = this.database
      .prepare(
        `
          SELECT
            component_id,
            project_id,
            component_type,
            scope,
            process_id,
            status,
            started_at,
            last_heartbeat_at,
            restart_count,
            reason,
            details_json,
            created_at,
            updated_at
          FROM runtime_components
          WHERE project_id = ?
          ORDER BY component_type ASC, created_at ASC
        `,
      )
      .all(projectId) as RuntimeComponentRow[]

    return rows.map(mapRuntimeComponentRow)
  }

  listGlobalRuntimeComponents(): RuntimeComponentSnapshot[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            component_id,
            project_id,
            component_type,
            scope,
            process_id,
            status,
            started_at,
            last_heartbeat_at,
            restart_count,
            reason,
            details_json,
            created_at,
            updated_at
          FROM runtime_components
          WHERE scope = 'global'
          ORDER BY component_type ASC, created_at ASC
        `,
      )
      .all() as RuntimeComponentRow[]

    return rows.map(mapRuntimeComponentRow)
  }

  listRuntimeHealthChecks(componentId: string): RuntimeHealthCheckSnapshot[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            health_check_id,
            component_id,
            project_id,
            status,
            checked_at,
            last_heartbeat_at,
            reason,
            details_json
          FROM runtime_health_checks
          WHERE component_id = ?
          ORDER BY checked_at DESC
        `,
      )
      .all(componentId) as RuntimeHealthCheckRow[]

    return rows.map(mapRuntimeHealthCheckRow)
  }

  getProjectRuntimeHealthSummary(
    projectId: ProjectId,
  ): ProjectRuntimeHealthSummary {
    const components = this.listProjectRuntimeComponents(projectId).filter(
      (component) => component.scope === "project",
    )
    const status = components.some((component) => component.status === "down")
      ? "down"
      : components.some((component) => component.status === "degraded")
        ? "degraded"
        : "healthy"
    const latestReason =
      [...components]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .find((component) => component.reason && component.reason.length > 0)
        ?.reason ?? null

    return {
      projectId,
      status: components.length > 0 ? status : "down",
      latestReason,
      components,
    }
  }

  private getProjectRuntimeSnapshotOrNull(
    projectId: ProjectId,
  ): ProjectRuntimeSnapshot | null {
    const row = readProjectRuntimeRow(
      this.database
        .prepare(
          `
            SELECT
              project_runtime_id,
              project_id,
              coordinator_id,
              coordinator_instance_id,
              status,
              started_at,
              last_heartbeat_at,
              restart_count,
              created_at,
              updated_at
            FROM project_runtimes
            WHERE project_id = ?
          `,
        )
        .get(projectId),
    )

    return row ? mapProjectRuntimeRow(row) : null
  }

  private getRuntimeComponentSnapshotOrNull(
    componentId: string,
  ): RuntimeComponentSnapshot | null {
    const row = readRuntimeComponentRow(
      this.database
        .prepare(
          `
            SELECT
              component_id,
              project_id,
              component_type,
              scope,
              process_id,
              status,
              started_at,
              last_heartbeat_at,
              restart_count,
              reason,
              details_json,
              created_at,
              updated_at
            FROM runtime_components
            WHERE component_id = ?
          `,
        )
        .get(componentId),
    )

    return row ? mapRuntimeComponentRow(row) : null
  }

  private getRuntimeComponentSnapshotOrThrow(
    componentId: string,
  ): RuntimeComponentSnapshot {
    const component = this.getRuntimeComponentSnapshotOrNull(componentId)

    if (!component) {
      throw new IpcProtocolError(
        "not_found",
        `Runtime component not found: ${componentId}`,
      )
    }

    return component
  }

  private assertProjectExists(projectId: ProjectId): void {
    const row = this.database
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(projectId) as { id: string } | undefined

    if (!row) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }
  }
}
