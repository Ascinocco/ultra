import type {
  ProjectId,
  ProjectRuntimeHealthSummary,
  ProjectRuntimeSnapshot,
  RuntimeComponentSnapshot,
  RuntimeComponentType,
  RuntimeHealthCheckSnapshot,
} from "@ultra/shared"

import type {
  RecordRuntimeHealthCheckInput,
  RuntimePersistenceService,
  UpsertProjectRuntimeInput,
  UpsertRuntimeComponentInput,
} from "./runtime-persistence-service.js"

export class RuntimeRegistry {
  private readonly projectRuntimesByProjectId = new Map<
    ProjectId,
    ProjectRuntimeSnapshot
  >()
  private readonly projectHealthByProjectId = new Map<
    ProjectId,
    ProjectRuntimeHealthSummary
  >()
  private readonly componentsById = new Map<string, RuntimeComponentSnapshot>()
  private readonly componentIdsByProjectId = new Map<ProjectId, Set<string>>()
  private readonly globalComponentIds = new Set<string>()
  private readonly componentUpdateListeners = new Set<
    (component: RuntimeComponentSnapshot) => void
  >()
  private readonly projectRuntimeUpdateListenersByProjectId = new Map<
    ProjectId,
    Set<(runtime: ProjectRuntimeSnapshot) => void>
  >()
  private readonly projectHealthUpdateListenersByProjectId = new Map<
    ProjectId,
    Set<(summary: ProjectRuntimeHealthSummary) => void>
  >()

  constructor(
    private readonly runtimePersistenceService: RuntimePersistenceService,
  ) {}

  hydrate(): void {
    this.projectRuntimesByProjectId.clear()
    this.projectHealthByProjectId.clear()
    this.componentsById.clear()
    this.componentIdsByProjectId.clear()
    this.globalComponentIds.clear()

    for (const runtime of this.runtimePersistenceService.listAllProjectRuntimeSnapshots()) {
      this.projectRuntimesByProjectId.set(runtime.projectId, runtime)
      for (const component of this.runtimePersistenceService.listProjectRuntimeComponents(
        runtime.projectId,
      )) {
        this.patchComponent(component, false)
      }
    }

    for (const component of this.runtimePersistenceService.listGlobalRuntimeComponents()) {
      this.patchComponent(component, false)
    }

    for (const runtime of this.projectRuntimesByProjectId.values()) {
      this.projectHealthByProjectId.set(
        runtime.projectId,
        this.computeProjectRuntimeHealthSummary(runtime.projectId),
      )
    }
  }

  subscribeToComponentUpdates(
    listener: (component: RuntimeComponentSnapshot) => void,
  ): () => void {
    this.componentUpdateListeners.add(listener)

    return () => {
      this.componentUpdateListeners.delete(listener)
    }
  }

  subscribeToProjectRuntimeUpdates(
    projectId: ProjectId,
    listener: (runtime: ProjectRuntimeSnapshot) => void,
  ): () => void {
    const listeners =
      this.projectRuntimeUpdateListenersByProjectId.get(projectId) ??
      new Set<(runtime: ProjectRuntimeSnapshot) => void>()

    listeners.add(listener)
    this.projectRuntimeUpdateListenersByProjectId.set(projectId, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.projectRuntimeUpdateListenersByProjectId.delete(projectId)
      }
    }
  }

  subscribeToProjectHealthUpdates(
    projectId: ProjectId,
    listener: (summary: ProjectRuntimeHealthSummary) => void,
  ): () => void {
    const listeners =
      this.projectHealthUpdateListenersByProjectId.get(projectId) ??
      new Set<(summary: ProjectRuntimeHealthSummary) => void>()

    listeners.add(listener)
    this.projectHealthUpdateListenersByProjectId.set(projectId, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.projectHealthUpdateListenersByProjectId.delete(projectId)
      }
    }
  }

  ensureProjectRuntime(projectId: ProjectId): ProjectRuntimeSnapshot {
    const previous = this.projectRuntimesByProjectId.get(projectId)
    const snapshot =
      this.runtimePersistenceService.ensureProjectRuntime(projectId)
    this.projectRuntimesByProjectId.set(projectId, snapshot)
    this.emitProjectRuntimeIfChanged(projectId, previous, snapshot)
    this.emitProjectHealthIfChanged(projectId)
    return snapshot
  }

  upsertProjectRuntime(
    input: UpsertProjectRuntimeInput,
  ): ProjectRuntimeSnapshot {
    const previous = this.projectRuntimesByProjectId.get(input.projectId)
    const snapshot = this.runtimePersistenceService.upsertProjectRuntime(input)
    this.projectRuntimesByProjectId.set(snapshot.projectId, snapshot)
    this.emitProjectRuntimeIfChanged(input.projectId, previous, snapshot)
    this.emitProjectHealthIfChanged(input.projectId)
    return snapshot
  }

  upsertRuntimeComponent(
    input: UpsertRuntimeComponentInput,
    emitUpdate = true,
  ): RuntimeComponentSnapshot {
    const snapshot =
      this.runtimePersistenceService.upsertRuntimeComponent(input)
    this.patchComponent(snapshot, emitUpdate)
    return snapshot
  }

  recordRuntimeHealthCheck(
    input: RecordRuntimeHealthCheckInput,
  ): RuntimeHealthCheckSnapshot {
    const snapshot =
      this.runtimePersistenceService.recordRuntimeHealthCheck(input)
    this.patchComponent(
      this.runtimePersistenceService.getRuntimeComponentSnapshot(
        input.componentId,
      ),
    )
    return snapshot
  }

  getProjectRuntimeSnapshot(projectId: ProjectId): ProjectRuntimeSnapshot {
    const snapshot = this.projectRuntimesByProjectId.get(projectId)

    if (snapshot) {
      return snapshot
    }

    const persisted =
      this.runtimePersistenceService.getProjectRuntimeSnapshot(projectId)
    this.projectRuntimesByProjectId.set(projectId, persisted)
    return persisted
  }

  getRuntimeComponent(componentId: string): RuntimeComponentSnapshot | null {
    const cached = this.componentsById.get(componentId)

    if (cached) {
      return cached
    }

    try {
      const persisted =
        this.runtimePersistenceService.getRuntimeComponentSnapshot(componentId)
      this.patchComponent(persisted, false)
      return persisted
    } catch {
      return null
    }
  }

  listAllProjectRuntimeSnapshots(): ProjectRuntimeSnapshot[] {
    const persisted =
      this.runtimePersistenceService.listAllProjectRuntimeSnapshots()

    for (const runtime of persisted) {
      this.projectRuntimesByProjectId.set(runtime.projectId, runtime)
    }

    return persisted
  }

  listProjectRuntimeComponents(
    projectId: ProjectId,
  ): RuntimeComponentSnapshot[] {
    const componentIds = this.componentIdsByProjectId.get(projectId)

    if (componentIds) {
      return [...componentIds]
        .map((componentId) => this.componentsById.get(componentId))
        .filter(
          (component): component is RuntimeComponentSnapshot =>
            component !== undefined,
        )
    }

    const persisted =
      this.runtimePersistenceService.listProjectRuntimeComponents(projectId)
    for (const component of persisted) {
      this.patchComponent(component)
    }

    return persisted
  }

  listGlobalRuntimeComponents(): RuntimeComponentSnapshot[] {
    if (this.globalComponentIds.size > 0) {
      return [...this.globalComponentIds]
        .map((componentId) => this.componentsById.get(componentId))
        .filter(
          (component): component is RuntimeComponentSnapshot =>
            component !== undefined,
        )
    }

    const persisted =
      this.runtimePersistenceService.listGlobalRuntimeComponents()
    for (const component of persisted) {
      this.patchComponent(component)
    }

    return persisted
  }

  getProjectRuntimeComponent(
    projectId: ProjectId,
    componentType: RuntimeComponentType,
  ): RuntimeComponentSnapshot | null {
    return (
      this.listProjectRuntimeComponents(projectId).find(
        (component) => component.componentType === componentType,
      ) ?? null
    )
  }

  getGlobalRuntimeComponent(
    componentType: RuntimeComponentType,
  ): RuntimeComponentSnapshot | null {
    return (
      this.listGlobalRuntimeComponents().find(
        (component) => component.componentType === componentType,
      ) ?? null
    )
  }

  getProjectRuntimeHealthSummary(
    projectId: ProjectId,
  ): ProjectRuntimeHealthSummary {
    const summary = this.computeProjectRuntimeHealthSummary(projectId)
    this.projectHealthByProjectId.set(projectId, summary)
    return summary
  }

  private computeProjectRuntimeHealthSummary(
    projectId: ProjectId,
  ): ProjectRuntimeHealthSummary {
    return {
      ...this.runtimePersistenceService.getProjectRuntimeHealthSummary(
        projectId,
      ),
      components: this.listProjectRuntimeComponents(projectId),
    }
  }

  private emitProjectRuntimeIfChanged(
    projectId: ProjectId,
    previous: ProjectRuntimeSnapshot | undefined,
    next: ProjectRuntimeSnapshot,
  ): void {
    if (
      previous !== undefined &&
      JSON.stringify(previous) === JSON.stringify(next)
    ) {
      return
    }

    const listeners =
      this.projectRuntimeUpdateListenersByProjectId.get(projectId)

    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(next)
    }
  }

  private emitProjectHealthIfChanged(projectId: ProjectId): void {
    const next = this.computeProjectRuntimeHealthSummary(projectId)
    const previous = this.projectHealthByProjectId.get(projectId)
    this.projectHealthByProjectId.set(projectId, next)

    if (
      previous !== undefined &&
      JSON.stringify(previous) === JSON.stringify(next)
    ) {
      return
    }

    const listeners =
      this.projectHealthUpdateListenersByProjectId.get(projectId)

    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(next)
    }
  }

  private patchComponent(
    component: RuntimeComponentSnapshot,
    emitUpdate = true,
  ): void {
    const previous = this.componentsById.get(component.componentId)
    this.componentsById.set(component.componentId, component)

    if (component.scope === "global") {
      this.globalComponentIds.add(component.componentId)
      if (component.projectId) {
        this.componentIdsByProjectId
          .get(component.projectId)
          ?.delete(component.componentId)
      }
    } else {
      this.globalComponentIds.delete(component.componentId)

      if (component.projectId) {
        const projectComponents =
          this.componentIdsByProjectId.get(component.projectId) ??
          new Set<string>()

        projectComponents.add(component.componentId)
        this.componentIdsByProjectId.set(component.projectId, projectComponents)
      }
    }

    if (
      emitUpdate &&
      (previous === undefined ||
        JSON.stringify(previous) !== JSON.stringify(component))
    ) {
      for (const listener of this.componentUpdateListeners) {
        listener(component)
      }
    }

    if (emitUpdate && component.projectId) {
      this.emitProjectHealthIfChanged(component.projectId)
    }
  }
}
