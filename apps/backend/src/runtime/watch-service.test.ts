import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { FakeSupervisedProcessAdapter } from "./fake-supervised-process-adapter.js"
import { RuntimePersistenceService } from "./runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime-registry.js"
import { RuntimeSupervisor } from "./runtime-supervisor.js"
import { WatchService } from "./watch-service.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

function createWorkspace(): { databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ultra-watch-service-"))
  temporaryDirectories.push(directory)

  return {
    databasePath: join(directory, "ultra.db"),
  }
}

describe("WatchService", () => {
  it("creates one global ov_watch component and reuses the live handle", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const persistence = new RuntimePersistenceService(runtime.database)
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const watchService = new WatchService(supervisor, registry, databasePath)

    const first = watchService.ensureRunning()
    const second = watchService.ensureRunning()

    expect(first.componentId).toBe(second.componentId)
    expect(first.projectId).toBeNull()
    expect(first.componentType).toBe("ov_watch")
    expect(adapter.spawns).toHaveLength(1)
    expect(watchService.listGlobalComponents()).toHaveLength(1)

    runtime.close()
  })

  it("persists a visible unhealthy state when spawning ov watch throws", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const persistence = new RuntimePersistenceService(
      runtime.database,
      () => "2026-03-16T22:00:00Z",
    )
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = {
      spawn: () => {
        throw new Error("spawn ENOENT")
      },
    }
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const watchService = new WatchService(
      supervisor,
      registry,
      databasePath,
      () => "2026-03-16T22:00:00Z",
    )

    const component = watchService.ensureRunning()

    expect(component.componentType).toBe("ov_watch")
    expect(component.projectId).toBeNull()
    expect(component.status).toBe("down")
    expect(component.reason).toContain("spawn ENOENT")
    expect(
      persistence.listRuntimeHealthChecks(component.componentId).at(-1)?.status,
    ).toBe("down")

    runtime.close()
  })

  it("marks an ov_watch start as down when the supervised handle has no pid", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const persistence = new RuntimePersistenceService(
      runtime.database,
      () => "2026-03-16T22:10:00Z",
    )
    const registry = new RuntimeRegistry(persistence)
    registry.hydrate()
    const adapter = new FakeSupervisedProcessAdapter()
    const supervisor = new RuntimeSupervisor(registry, adapter)
    const watchService = new WatchService(
      supervisor,
      registry,
      databasePath,
      () => "2026-03-16T22:10:00Z",
    )

    vi.spyOn(adapter, "spawn").mockReturnValue({
      pid: null,
      kill: () => undefined,
      onExit: () => () => undefined,
    })

    const component = watchService.ensureRunning()

    expect(component.status).toBe("down")
    expect(component.reason).toContain("process id was not assigned")

    runtime.close()
  })
})
