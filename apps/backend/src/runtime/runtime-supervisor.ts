import type { ProjectId, RuntimeComponentSnapshot } from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import type { RuntimeRegistry } from "./runtime-registry.js"
import type {
  SupervisedProcessAdapter,
  SupervisedProcessHandle,
  SupervisedProcessSpec,
} from "./supervised-process-adapter.js"

export type RuntimeSupervisorPolicy = {
  maxRestartAttempts: number
  mediumRestartDelayMs: number
  shortRestartDelayMs: number
  stabilityWindowMs: number
}

export const DEFAULT_RUNTIME_SUPERVISOR_POLICY: RuntimeSupervisorPolicy = {
  maxRestartAttempts: 3,
  mediumRestartDelayMs: 250,
  shortRestartDelayMs: 50,
  stabilityWindowMs: 1_000,
}

type RuntimeSupervisorState = {
  handle: SupervisedProcessHandle | null
  restartAttemptsInWindow: number
  restartTimer: ReturnType<typeof setTimeout> | null
  spec: SupervisedProcessSpec
  stabilityTimer: ReturnType<typeof setTimeout> | null
  stopRequested: boolean
}

type ProcessExitEvent = {
  code: number | null
  error?: string | null
  signal: NodeJS.Signals | null
}

function buildExitReason(event: ProcessExitEvent): string {
  if (event.error) {
    return event.error
  }

  if (event.signal) {
    return `Process exited due to signal ${event.signal}.`
  }

  if (event.code === null) {
    return "Process exited unexpectedly."
  }

  return `Process exited with code ${event.code}.`
}

function restartDelayMs(
  attempt: number,
  policy: RuntimeSupervisorPolicy,
): number | null {
  if (attempt > policy.maxRestartAttempts) {
    return null
  }

  if (attempt <= 1) {
    return 0
  }

  if (attempt === 2) {
    return policy.shortRestartDelayMs
  }

  if (attempt === 3) {
    return policy.mediumRestartDelayMs
  }

  return null
}

export class RuntimeSupervisor {
  private readonly statesByComponentId = new Map<
    string,
    RuntimeSupervisorState
  >()

  constructor(
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly processAdapter: SupervisedProcessAdapter,
    private readonly policy: RuntimeSupervisorPolicy = DEFAULT_RUNTIME_SUPERVISOR_POLICY,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  dispose(): void {
    for (const [componentId] of this.statesByComponentId) {
      this.disposeState(componentId)
    }
  }

  ensureRunning(spec: SupervisedProcessSpec): RuntimeComponentSnapshot {
    const component = this.ensureComponentRecord(spec)
    const state =
      this.statesByComponentId.get(component.componentId) ??
      this.createState(component.componentId, spec)

    state.spec = spec
    state.stopRequested = false

    if (state.handle) {
      return this.getPersistedComponent(component.componentId)
    }

    if (state.restartTimer) {
      clearTimeout(state.restartTimer)
      state.restartTimer = null
    }

    return this.spawnComponent(component.componentId, spec)
  }

  getLiveHandle(componentId: string): SupervisedProcessHandle | null {
    return this.statesByComponentId.get(componentId)?.handle ?? null
  }

  hydrate(): void {
    this.dispose()
    this.runtimeRegistry.hydrate()
  }

  restart(componentId: string): RuntimeComponentSnapshot {
    const component = this.getPersistedComponent(componentId)
    const state = this.statesByComponentId.get(componentId)

    if (!state) {
      throw new IpcProtocolError(
        "not_found",
        `Runtime component is not supervised in this backend process: ${componentId}`,
      )
    }

    if (state.restartTimer) {
      clearTimeout(state.restartTimer)
      state.restartTimer = null
    }

    state.stopRequested = true
    state.handle?.kill()
    state.handle = null
    state.stopRequested = false

    return this.spawnComponent(component.componentId, state.spec)
  }

  stop(componentId: string): RuntimeComponentSnapshot {
    const component = this.getPersistedComponent(componentId)
    const state = this.statesByComponentId.get(componentId)
    const timestamp = this.now()

    if (state?.restartTimer) {
      clearTimeout(state.restartTimer)
      state.restartTimer = null
    }

    if (state?.stabilityTimer) {
      clearTimeout(state.stabilityTimer)
      state.stabilityTimer = null
    }

    if (state?.handle) {
      state.stopRequested = true
      state.handle.kill()
      state.handle = null
    }

    const stopped = this.runtimeRegistry.upsertRuntimeComponent({
      componentId,
      componentType: component.componentType,
      details: component.details,
      lastHeartbeatAt: timestamp,
      processId: null,
      projectId: component.projectId,
      reason: "Stopped by runtime supervisor.",
      restartCount: component.restartCount,
      scope: component.scope,
      startedAt: component.startedAt,
      status: "down",
    })

    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: timestamp,
      componentId,
      details: stopped.details,
      lastHeartbeatAt: timestamp,
      projectId: stopped.projectId,
      reason: stopped.reason,
      status: "down",
    })

    if (stopped.projectId) {
      this.syncProjectRuntime(stopped.projectId, timestamp)
    }

    return stopped
  }

  private createState(
    componentId: string,
    spec: SupervisedProcessSpec,
  ): RuntimeSupervisorState {
    const state: RuntimeSupervisorState = {
      handle: null,
      restartAttemptsInWindow: 0,
      restartTimer: null,
      spec,
      stabilityTimer: null,
      stopRequested: false,
    }

    this.statesByComponentId.set(componentId, state)
    return state
  }

  private disposeState(componentId: string): void {
    const state = this.statesByComponentId.get(componentId)

    if (!state) {
      return
    }

    if (state.restartTimer) {
      clearTimeout(state.restartTimer)
    }

    if (state.stabilityTimer) {
      clearTimeout(state.stabilityTimer)
    }

    state.handle?.kill()
    this.statesByComponentId.delete(componentId)
  }

  private ensureComponentRecord(
    spec: SupervisedProcessSpec,
  ): RuntimeComponentSnapshot {
    if (spec.scope === "project" && !spec.projectId) {
      throw new IpcProtocolError(
        "invalid_request",
        "Project-scoped supervised processes require a project id.",
      )
    }

    if (spec.projectId) {
      this.runtimeRegistry.ensureProjectRuntime(spec.projectId)
    }

    const existing =
      spec.scope === "project" && spec.projectId
        ? this.runtimeRegistry.getProjectRuntimeComponent(
            spec.projectId,
            spec.componentType,
          )
        : this.runtimeRegistry.getGlobalRuntimeComponent(spec.componentType)

    if (existing) {
      return this.runtimeRegistry.upsertRuntimeComponent({
        componentId: existing.componentId,
        componentType: spec.componentType,
        details: spec.details ?? existing.details,
        lastHeartbeatAt: existing.lastHeartbeatAt,
        processId: existing.processId,
        projectId: spec.projectId ?? existing.projectId,
        reason: existing.reason,
        restartCount: existing.restartCount,
        scope: spec.scope,
        startedAt: existing.startedAt,
        status: existing.status,
      })
    }

    return this.runtimeRegistry.upsertRuntimeComponent(
      {
        componentType: spec.componentType,
        details: spec.details ?? null,
        projectId: spec.projectId ?? null,
        scope: spec.scope,
        status: "down",
      },
      false,
    )
  }

  private getPersistedComponent(componentId: string): RuntimeComponentSnapshot {
    const projectComponents = [
      ...this.runtimeRegistry.listGlobalRuntimeComponents(),
      ...this.runtimeRegistry
        .listAllProjectRuntimeSnapshots()
        .flatMap((runtime) =>
          this.runtimeRegistry.listProjectRuntimeComponents(runtime.projectId),
        ),
    ]
    const component = projectComponents.find(
      (candidate) => candidate.componentId === componentId,
    )

    if (!component) {
      throw new IpcProtocolError(
        "not_found",
        `Runtime component not found: ${componentId}`,
      )
    }

    return component
  }

  private handleAbnormalExit(
    componentId: string,
    event: ProcessExitEvent,
    handle: SupervisedProcessHandle,
  ): void {
    const state = this.statesByComponentId.get(componentId)

    if (!state || state.handle !== handle) {
      return
    }

    if (state.stopRequested) {
      return
    }

    state.handle = null
    if (state.stabilityTimer) {
      clearTimeout(state.stabilityTimer)
      state.stabilityTimer = null
    }

    const component = this.getPersistedComponent(componentId)
    const timestamp = this.now()
    const updated = this.runtimeRegistry.upsertRuntimeComponent({
      componentId,
      componentType: component.componentType,
      details: component.details,
      lastHeartbeatAt: timestamp,
      processId: null,
      projectId: component.projectId,
      reason: buildExitReason(event),
      restartCount: component.restartCount + 1,
      scope: component.scope,
      startedAt: component.startedAt,
      status: "degraded",
    })

    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: timestamp,
      componentId,
      details: updated.details,
      lastHeartbeatAt: timestamp,
      projectId: updated.projectId,
      reason: updated.reason,
      status: "degraded",
    })

    if (updated.projectId) {
      this.syncProjectRuntime(updated.projectId, timestamp)
    }

    state.restartAttemptsInWindow += 1
    const delay = restartDelayMs(state.restartAttemptsInWindow, this.policy)

    if (delay === null) {
      return
    }

    state.restartTimer = setTimeout(() => {
      state.restartTimer = null
      this.spawnComponent(componentId, state.spec)
    }, delay)
  }

  private spawnComponent(
    componentId: string,
    spec: SupervisedProcessSpec,
  ): RuntimeComponentSnapshot {
    const component = this.getPersistedComponent(componentId)
    const state =
      this.statesByComponentId.get(componentId) ??
      this.createState(componentId, spec)
    const timestamp = this.now()
    const handle = this.processAdapter.spawn(spec)

    state.handle = handle
    state.spec = spec
    state.stopRequested = false

    if (state.stabilityTimer) {
      clearTimeout(state.stabilityTimer)
    }

    state.stabilityTimer = setTimeout(() => {
      state.restartAttemptsInWindow = 0
      state.stabilityTimer = null
    }, this.policy.stabilityWindowMs)

    handle.onExit((event) => {
      this.handleAbnormalExit(componentId, event, handle)
    })

    const updated = this.runtimeRegistry.upsertRuntimeComponent({
      componentId,
      componentType: spec.componentType,
      details: spec.details ?? component.details,
      lastHeartbeatAt: timestamp,
      processId: handle.pid,
      projectId: spec.projectId ?? component.projectId,
      reason: null,
      restartCount: component.restartCount,
      scope: spec.scope,
      startedAt: timestamp,
      status: "healthy",
    })

    this.runtimeRegistry.recordRuntimeHealthCheck({
      checkedAt: timestamp,
      componentId,
      details: updated.details,
      lastHeartbeatAt: timestamp,
      projectId: updated.projectId,
      reason: null,
      status: "healthy",
    })

    if (updated.projectId) {
      this.syncProjectRuntime(updated.projectId, timestamp)
    }

    return updated
  }

  private syncProjectRuntime(projectId: ProjectId, timestamp: string): void {
    const runtime = this.runtimeRegistry.ensureProjectRuntime(projectId)
    const summary =
      this.runtimeRegistry.getProjectRuntimeHealthSummary(projectId)
    const nextStatus =
      summary.components.length === 0
        ? "idle"
        : summary.status === "healthy"
          ? "running"
          : summary.status

    this.runtimeRegistry.upsertProjectRuntime({
      coordinatorId: runtime.coordinatorId,
      coordinatorInstanceId: runtime.coordinatorInstanceId,
      lastHeartbeatAt:
        summary.components.length === 0 ? runtime.lastHeartbeatAt : timestamp,
      projectId,
      restartCount: Math.max(
        runtime.restartCount,
        ...summary.components.map((component) => component.restartCount),
      ),
      startedAt:
        summary.components.length === 0
          ? runtime.startedAt
          : (runtime.startedAt ?? timestamp),
      status: nextStatus,
    })
  }
}
