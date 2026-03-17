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
  const directory = mkdtempSync(join(tmpdir(), "ultra-runtime-registry-"))
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

describe("RuntimeRegistry", () => {
  it("emits project runtime updates when runtime state changes", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const registry = new RuntimeRegistry(
      new RuntimePersistenceService(runtime.database),
    )
    registry.hydrate()
    const project = projectService.open({ path: projectPath })
    const updates: string[] = []

    registry.subscribeToProjectRuntimeUpdates(project.id, (snapshot) => {
      updates.push(snapshot.status)
    })

    registry.ensureProjectRuntime(project.id)
    registry.upsertProjectRuntime({
      coordinatorId: "coord_123",
      coordinatorInstanceId: "coord_inst_123",
      lastHeartbeatAt: "2026-03-17T15:10:00Z",
      projectId: project.id,
      restartCount: 1,
      startedAt: "2026-03-17T15:00:00Z",
      status: "running",
    })
    registry.upsertProjectRuntime({
      coordinatorId: "coord_123",
      coordinatorInstanceId: "coord_inst_123",
      lastHeartbeatAt: "2026-03-17T15:10:00Z",
      projectId: project.id,
      restartCount: 1,
      startedAt: "2026-03-17T15:00:00Z",
      status: "running",
    })

    expect(updates).toEqual(["idle", "running"])

    runtime.close()
  })

  it("emits project health updates when component changes affect aggregate health", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const registry = new RuntimeRegistry(
      new RuntimePersistenceService(runtime.database),
    )
    registry.hydrate()
    const project = projectService.open({ path: projectPath })
    const statuses: string[] = []

    registry.subscribeToProjectHealthUpdates(project.id, (summary) => {
      statuses.push(summary.status)
    })

    registry.upsertRuntimeComponent({
      componentType: "coordinator",
      projectId: project.id,
      scope: "project",
      status: "healthy",
    })
    registry.upsertRuntimeComponent({
      componentType: "watchdog",
      projectId: project.id,
      scope: "project",
      status: "degraded",
      reason: "watchdog suspect",
    })
    const watchdogComponent = registry.getProjectRuntimeComponent(
      project.id,
      "watchdog",
    )

    if (!watchdogComponent) {
      throw new Error("Expected watchdog component to exist.")
    }

    registry.recordRuntimeHealthCheck({
      componentId: watchdogComponent.componentId,
      projectId: project.id,
      status: "degraded",
      reason: "watchdog suspect",
    })

    expect(statuses).toEqual(["healthy", "degraded", "degraded"])

    runtime.close()
  })

  it("does not emit component or project runtime noise during hydrate", () => {
    const { databasePath, projectPath } = createWorkspace()
    const firstRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(firstRuntime.database)
    const firstRegistry = new RuntimeRegistry(
      new RuntimePersistenceService(firstRuntime.database),
    )
    firstRegistry.hydrate()
    const project = projectService.open({ path: projectPath })

    firstRegistry.upsertProjectRuntime({
      coordinatorId: "coord_123",
      coordinatorInstanceId: "coord_inst_123",
      lastHeartbeatAt: "2026-03-17T15:20:00Z",
      projectId: project.id,
      restartCount: 1,
      startedAt: "2026-03-17T15:00:00Z",
      status: "running",
    })
    firstRegistry.upsertRuntimeComponent({
      componentType: "coordinator",
      projectId: project.id,
      scope: "project",
      status: "healthy",
    })
    firstRuntime.close()

    const secondRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const secondRegistry = new RuntimeRegistry(
      new RuntimePersistenceService(secondRuntime.database),
    )
    const componentUpdates: string[] = []
    const runtimeUpdates: string[] = []
    const healthUpdates: string[] = []

    secondRegistry.subscribeToComponentUpdates((component) => {
      componentUpdates.push(component.componentId)
    })
    secondRegistry.subscribeToProjectRuntimeUpdates(project.id, (snapshot) => {
      runtimeUpdates.push(snapshot.projectRuntimeId)
    })
    secondRegistry.subscribeToProjectHealthUpdates(project.id, (summary) => {
      healthUpdates.push(summary.status)
    })

    secondRegistry.hydrate()

    expect(componentUpdates).toEqual([])
    expect(runtimeUpdates).toEqual([])
    expect(healthUpdates).toEqual([])

    secondRuntime.close()
  })
})
