import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { RuntimePersistenceService } from "./runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime-registry.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  projectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-runtime-service-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    databasePath: join(directory, "ultra.db"),
    projectPath,
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

describe("RuntimePersistenceService", () => {
  it("creates one runtime row per project and keeps ensureProjectRuntime idempotent", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new RuntimePersistenceService(
      runtime.database,
      () => "2026-03-15T16:00:00Z",
    )
    const project = projectService.open({ path: projectPath })

    const first = service.ensureProjectRuntime(project.id)
    const second = service.ensureProjectRuntime(project.id)

    expect(first.projectRuntimeId).toBe(second.projectRuntimeId)
    expect(first.status).toBe("idle")

    runtime.close()
  })

  it("persists project-scoped and global components distinctly", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new RuntimePersistenceService(
      runtime.database,
      () => "2026-03-15T16:05:00Z",
    )
    const project = projectService.open({ path: projectPath })

    const coordinator = service.upsertRuntimeComponent({
      projectId: project.id,
      componentType: "coordinator",
      scope: "project",
      status: "healthy",
      processId: 101,
      details: { coordinatorId: "coord_1" },
    })
    const ovWatch = service.upsertRuntimeComponent({
      componentType: "ov_watch",
      scope: "global",
      status: "degraded",
      reason: "watch stalled",
    })

    expect(service.listProjectRuntimeComponents(project.id)).toEqual([
      expect.objectContaining({
        componentId: coordinator.componentId,
        projectId: project.id,
      }),
    ])
    expect(service.listGlobalRuntimeComponents()).toEqual([
      expect.objectContaining({
        componentId: ovWatch.componentId,
        projectId: null,
      }),
    ])

    runtime.close()
  })

  it("updates existing components, records health checks, and computes project health from project-scoped components only", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T16:10:0${tick}Z`
    }
    const service = new RuntimePersistenceService(runtime.database, now)
    const project = projectService.open({ path: projectPath })

    const coordinator = service.upsertRuntimeComponent({
      projectId: project.id,
      componentType: "coordinator",
      scope: "project",
      status: "healthy",
      processId: 9001,
    })
    service.upsertRuntimeComponent({
      componentId: coordinator.componentId,
      projectId: project.id,
      componentType: "coordinator",
      scope: "project",
      status: "degraded",
      processId: 9002,
      reason: "restart in progress",
    })
    service.upsertRuntimeComponent({
      componentType: "ov_watch",
      scope: "global",
      status: "down",
      reason: "global watch offline",
    })

    const healthCheck = service.recordRuntimeHealthCheck({
      componentId: coordinator.componentId,
      status: "degraded",
      reason: "heartbeat missed",
      details: { source: "watchdog" },
    })
    const component = service.getRuntimeComponentSnapshot(
      coordinator.componentId,
    )
    const summary = service.getProjectRuntimeHealthSummary(project.id)

    expect(component.processId).toBe(9002)
    expect(component.reason).toBe("heartbeat missed")
    expect(component.details).toEqual({ source: "watchdog" })
    expect(service.listRuntimeHealthChecks(coordinator.componentId)).toEqual([
      expect.objectContaining({
        healthCheckId: healthCheck.healthCheckId,
        status: "degraded",
      }),
    ])
    expect(summary.status).toBe("degraded")
    expect(summary.latestReason).toBe("heartbeat missed")
    expect(summary.components).toHaveLength(1)

    runtime.close()
  })

  it("hydrates the in-memory registry from persisted rows after restart", () => {
    const { databasePath, projectPath } = createWorkspace()
    const firstRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(firstRuntime.database)
    const firstService = new RuntimePersistenceService(
      firstRuntime.database,
      () => "2026-03-15T16:20:00Z",
    )
    const project = projectService.open({ path: projectPath })

    firstService.upsertProjectRuntime({
      projectId: project.id,
      coordinatorId: "coord_123",
      coordinatorInstanceId: "coord_inst_123",
      status: "running",
      startedAt: "2026-03-15T16:20:00Z",
      lastHeartbeatAt: "2026-03-15T16:20:00Z",
      restartCount: 1,
    })
    firstService.upsertRuntimeComponent({
      projectId: project.id,
      componentType: "watchdog",
      scope: "project",
      status: "healthy",
    })
    firstService.upsertRuntimeComponent({
      componentType: "ov_watch",
      scope: "global",
      status: "healthy",
    })
    firstRuntime.close()

    const secondRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const secondService = new RuntimePersistenceService(secondRuntime.database)
    const registry = new RuntimeRegistry(secondService)

    registry.hydrate()

    expect(registry.getProjectRuntimeSnapshot(project.id)).toEqual(
      expect.objectContaining({
        projectId: project.id,
        coordinatorId: "coord_123",
        status: "running",
      }),
    )
    expect(registry.listProjectRuntimeComponents(project.id)).toEqual([
      expect.objectContaining({
        componentType: "watchdog",
      }),
    ])
    expect(registry.listGlobalRuntimeComponents()).toEqual([
      expect.objectContaining({
        componentType: "ov_watch",
      }),
    ])

    secondRuntime.close()
  })
})
