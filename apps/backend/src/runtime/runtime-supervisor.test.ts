import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { FakeSupervisedProcessAdapter } from "./fake-supervised-process-adapter.js"
import { RuntimePersistenceService } from "./runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime-registry.js"
import {
  RuntimeSupervisor,
  type RuntimeSupervisorPolicy,
} from "./runtime-supervisor.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  firstProjectPath: string
  secondProjectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-runtime-supervisor-"))
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

describe("RuntimeSupervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("creates a runtime component row and live handle for a project-scoped component", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistence = new RuntimePersistenceService(
      runtime.database,
      () => "2026-03-16T20:00:00Z",
    )
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const project = projectService.open({ path: firstProjectPath })

    const component = supervisor.ensureRunning({
      args: ["watch"],
      command: "ov",
      componentType: "watchdog",
      cwd: firstProjectPath,
      env: { ULTRA_PROJECT: project.id },
      projectId: project.id,
      scope: "project",
    })

    expect(component.projectId).toBe(project.id)
    expect(component.componentType).toBe("watchdog")
    expect(component.status).toBe("healthy")
    expect(component.processId).toBe(adapter.spawns[0]?.handle.pid)
    expect(supervisor.getLiveHandle(component.componentId)).not.toBeNull()
    expect(registry.getProjectRuntimeSnapshot(project.id).status).toBe(
      "running",
    )

    runtime.close()
  })

  it("keeps ensureRunning idempotent for an already-running component", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistence = new RuntimePersistenceService(runtime.database)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const project = projectService.open({ path: firstProjectPath })

    const first = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: firstProjectPath,
      projectId: project.id,
      scope: "project",
    })
    const second = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: firstProjectPath,
      projectId: project.id,
      scope: "project",
    })

    expect(first.componentId).toBe(second.componentId)
    expect(adapter.spawns).toHaveLength(1)

    runtime.close()
  })

  it("persists global and project-scoped supervised components distinctly", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistence = new RuntimePersistenceService(runtime.database)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const project = projectService.open({ path: firstProjectPath })

    const projectComponent = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: firstProjectPath,
      projectId: project.id,
      scope: "project",
    })
    const globalComponent = supervisor.ensureRunning({
      args: ["watch"],
      command: "ov",
      componentType: "ov_watch",
      scope: "global",
    })

    expect(projectComponent.projectId).toBe(project.id)
    expect(globalComponent.projectId).toBeNull()
    expect(registry.listProjectRuntimeComponents(project.id)).toHaveLength(1)
    expect(registry.listGlobalRuntimeComponents()).toHaveLength(1)

    runtime.close()
  })

  it("restarts failed processes according to policy and records health transitions", async () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-16T20:10:${String(tick).padStart(2, "0")}Z`
    }
    const persistence = new RuntimePersistenceService(runtime.database, now)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const policy: RuntimeSupervisorPolicy = {
      maxRestartAttempts: 3,
      mediumRestartDelayMs: 20,
      shortRestartDelayMs: 10,
      stabilityWindowMs: 100,
    }
    const supervisor = new RuntimeSupervisor(registry, adapter, policy, now)
    const project = projectService.open({ path: firstProjectPath })

    const component = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: firstProjectPath,
      projectId: project.id,
      scope: "project",
    })

    adapter.spawns[0]?.handle.emitExit({
      code: 1,
      signal: null,
    })
    await vi.runOnlyPendingTimersAsync()

    const restarted = registry.getProjectRuntimeComponent(
      project.id,
      "coordinator",
    )

    expect(adapter.spawns).toHaveLength(2)
    expect(restarted?.restartCount).toBe(1)
    expect(restarted?.status).toBe("healthy")
    expect(
      persistence
        .listRuntimeHealthChecks(component.componentId)
        .map((snapshot) => snapshot.status),
    ).toEqual(["healthy", "degraded", "healthy"])

    runtime.close()
  })

  it("marks a component degraded and stops restarting after the restart budget is exhausted", async () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-16T20:20:${String(tick).padStart(2, "0")}Z`
    }
    const persistence = new RuntimePersistenceService(runtime.database, now)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const policy: RuntimeSupervisorPolicy = {
      maxRestartAttempts: 3,
      mediumRestartDelayMs: 20,
      shortRestartDelayMs: 10,
      stabilityWindowMs: 100,
    }
    const supervisor = new RuntimeSupervisor(registry, adapter, policy, now)
    const project = projectService.open({ path: firstProjectPath })

    const component = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: firstProjectPath,
      projectId: project.id,
      scope: "project",
    })

    for (let index = 0; index < 3; index += 1) {
      adapter.spawns[index]?.handle.emitExit({
        code: 1,
        signal: null,
      })
      await vi.runOnlyPendingTimersAsync()
    }

    adapter.spawns[3]?.handle.emitExit({
      code: 2,
      signal: null,
    })
    await vi.runOnlyPendingTimersAsync()

    const exhausted = registry.getProjectRuntimeComponent(
      project.id,
      "coordinator",
    )

    expect(adapter.spawns).toHaveLength(4)
    expect(exhausted?.restartCount).toBe(4)
    expect(exhausted?.status).toBe("degraded")
    expect(supervisor.getLiveHandle(component.componentId)).toBeNull()

    runtime.close()
  })

  it("marks stopped components down without scheduling restarts", async () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistence = new RuntimePersistenceService(runtime.database)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const project = projectService.open({ path: firstProjectPath })

    const component = supervisor.ensureRunning({
      args: ["watch"],
      command: "ov",
      componentType: "watchdog",
      cwd: firstProjectPath,
      projectId: project.id,
      scope: "project",
    })
    const handle = adapter.spawns[0]?.handle

    const stopped = supervisor.stop(component.componentId)
    handle?.emitExit({
      code: null,
      signal: "SIGTERM",
    })
    await vi.runOnlyPendingTimersAsync()

    expect(stopped.status).toBe("down")
    expect(handle?.killCalls).toBe(1)
    expect(adapter.spawns).toHaveLength(1)
    expect(supervisor.getLiveHandle(component.componentId)).toBeNull()

    runtime.close()
  })

  it("restarts a live component on demand", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistence = new RuntimePersistenceService(runtime.database)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const project = projectService.open({ path: firstProjectPath })

    const component = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: firstProjectPath,
      projectId: project.id,
      scope: "project",
    })
    const originalHandle = adapter.spawns[0]?.handle

    const restarted = supervisor.restart(component.componentId)

    expect(originalHandle?.killCalls).toBe(1)
    expect(adapter.spawns).toHaveLength(2)
    expect(restarted.processId).toBe(adapter.spawns[1]?.handle.pid)
    expect(restarted.status).toBe("healthy")

    runtime.close()
  })

  it("hydrates persisted state without fabricating live handles", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const firstRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(firstRuntime.database)
    const persistence = new RuntimePersistenceService(
      firstRuntime.database,
      () => "2026-03-16T20:30:00Z",
    )
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const project = projectService.open({ path: firstProjectPath })

    persistence.ensureProjectRuntime(project.id)
    persistence.upsertRuntimeComponent({
      componentType: "coordinator",
      processId: 4321,
      projectId: project.id,
      scope: "project",
      startedAt: "2026-03-16T20:30:00Z",
      status: "healthy",
    })
    firstRuntime.close()

    const secondRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const secondPersistence = new RuntimePersistenceService(
      secondRuntime.database,
    )
    const secondRegistry = new RuntimeRegistry(secondPersistence)
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(secondRegistry, adapter)

    supervisor.hydrate()

    const hydrated = secondRegistry.getProjectRuntimeComponent(
      project.id,
      "coordinator",
    )

    expect(hydrated).toEqual(
      expect.objectContaining({
        componentType: "coordinator",
        processId: 4321,
        status: "healthy",
      }),
    )
    expect(
      supervisor.getLiveHandle(hydrated?.componentId ?? "missing"),
    ).toBeNull()
    expect(adapter.spawns).toHaveLength(0)

    secondRuntime.close()
  })

  it("keeps different projects isolated when supervising project-scoped components", () => {
    const { databasePath, firstProjectPath, secondProjectPath } =
      createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const persistence = new RuntimePersistenceService(runtime.database)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const firstProject = projectService.open({ path: firstProjectPath })
    const secondProject = projectService.open({ path: secondProjectPath })

    const first = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: firstProjectPath,
      projectId: firstProject.id,
      scope: "project",
    })
    const second = supervisor.ensureRunning({
      args: ["coord"],
      command: "ov",
      componentType: "coordinator",
      cwd: secondProjectPath,
      projectId: secondProject.id,
      scope: "project",
    })

    expect(first.componentId).not.toBe(second.componentId)
    expect(registry.listProjectRuntimeComponents(firstProject.id)).toHaveLength(
      1,
    )
    expect(
      registry.listProjectRuntimeComponents(secondProject.id),
    ).toHaveLength(1)

    runtime.close()
  })
})
