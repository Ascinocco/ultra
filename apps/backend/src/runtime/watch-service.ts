import { dirname } from "node:path"
import type { RuntimeComponentSnapshot, RuntimeDetails } from "@ultra/shared"

import type { RuntimeRegistry } from "./runtime-registry.js"
import type { RuntimeSupervisor } from "./runtime-supervisor.js"

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class WatchService {
  private readonly workingDirectory: string

  constructor(
    private readonly runtimeSupervisor: RuntimeSupervisor,
    private readonly runtimeRegistry: RuntimeRegistry,
    databasePath: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.workingDirectory = dirname(databasePath)
  }

  ensureRunning(): RuntimeComponentSnapshot {
    try {
      const component = this.runtimeSupervisor.ensureRunning({
        args: ["watch"],
        command: "ov",
        componentType: "ov_watch",
        cwd: this.workingDirectory,
        details: this.buildDetails(),
        env: {},
        scope: "global",
      })

      if (component.processId !== null) {
        return component
      }

      return this.markUnavailable(
        "Unable to start `ov watch`: process id was not assigned.",
      )
    } catch (error) {
      return this.markUnavailable(normalizeErrorMessage(error))
    }
  }

  getSnapshot(): RuntimeComponentSnapshot | null {
    return this.runtimeRegistry.getGlobalRuntimeComponent("ov_watch")
  }

  listGlobalComponents(): RuntimeComponentSnapshot[] {
    return this.runtimeRegistry.listGlobalRuntimeComponents()
  }

  restart(): RuntimeComponentSnapshot {
    const component = this.getSnapshot()

    if (!component) {
      return this.ensureRunning()
    }

    return this.runtimeSupervisor.restart(component.componentId)
  }

  stop(): RuntimeComponentSnapshot | null {
    const component = this.getSnapshot()

    if (!component) {
      return null
    }

    return this.runtimeSupervisor.stop(component.componentId)
  }

  private buildDetails(): RuntimeDetails {
    return {
      args: ["watch"],
      command: "ov",
      cwd: this.workingDirectory,
    }
  }

  private markUnavailable(reason: string): RuntimeComponentSnapshot {
    const timestamp = this.now()
    const existing = this.getSnapshot()
    const component = this.runtimeRegistry.upsertRuntimeComponent({
      ...(existing ? { componentId: existing.componentId } : {}),
      componentType: "ov_watch",
      details: this.buildDetails(),
      lastHeartbeatAt: timestamp,
      processId: null,
      projectId: null,
      reason,
      restartCount: existing?.restartCount ?? 0,
      scope: "global",
      startedAt: existing?.startedAt ?? null,
      status: "down",
    })

    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: timestamp,
      componentId: component.componentId,
      details: component.details,
      lastHeartbeatAt: timestamp,
      projectId: null,
      reason,
      status: "down",
    })

    return (
      this.runtimeRegistry.getGlobalRuntimeComponent("ov_watch") ?? component
    )
  }
}
