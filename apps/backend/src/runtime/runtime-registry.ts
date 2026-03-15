import type {
  ProjectId,
  ProjectRuntimeHealthSummary,
  ProjectRuntimeSnapshot,
  RuntimeComponentSnapshot,
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
  private readonly componentsById = new Map<string, RuntimeComponentSnapshot>()
  private readonly componentIdsByProjectId = new Map<ProjectId, Set<string>>()
  private readonly globalComponentIds = new Set<string>()

  constructor(
    private readonly runtimePersistenceService: RuntimePersistenceService,
  ) {}

  hydrate(): void {
    this.projectRuntimesByProjectId.clear()
    this.componentsById.clear()
    this.componentIdsByProjectId.clear()
    this.globalComponentIds.clear()

    for (const runtime of this.runtimePersistenceService.listAllProjectRuntimeSnapshots()) {
      this.projectRuntimesByProjectId.set(runtime.projectId, runtime)
      for (const component of this.runtimePersistenceService.listProjectRuntimeComponents(
        runtime.projectId,
      )) {
        this.patchComponent(component)
      }
    }

    for (const component of this.runtimePersistenceService.listGlobalRuntimeComponents()) {
      this.patchComponent(component)
    }
  }

  ensureProjectRuntime(projectId: ProjectId): ProjectRuntimeSnapshot {
    const snapshot =
      this.runtimePersistenceService.ensureProjectRuntime(projectId)
    this.projectRuntimesByProjectId.set(projectId, snapshot)
    return snapshot
  }

  upsertProjectRuntime(
    input: UpsertProjectRuntimeInput,
  ): ProjectRuntimeSnapshot {
    const snapshot = this.runtimePersistenceService.upsertProjectRuntime(input)
    this.projectRuntimesByProjectId.set(snapshot.projectId, snapshot)
    return snapshot
  }

  upsertRuntimeComponent(
    input: UpsertRuntimeComponentInput,
  ): RuntimeComponentSnapshot {
    const snapshot =
      this.runtimePersistenceService.upsertRuntimeComponent(input)
    this.patchComponent(snapshot)
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

  getProjectRuntimeHealthSummary(
    projectId: ProjectId,
  ): ProjectRuntimeHealthSummary {
    return {
      ...this.runtimePersistenceService.getProjectRuntimeHealthSummary(
        projectId,
      ),
      components: this.listProjectRuntimeComponents(projectId),
    }
  }

  private patchComponent(component: RuntimeComponentSnapshot): void {
    this.componentsById.set(component.componentId, component)

    if (component.scope === "global") {
      this.globalComponentIds.add(component.componentId)
      if (component.projectId) {
        this.componentIdsByProjectId
          .get(component.projectId)
          ?.delete(component.componentId)
      }
      return
    }

    this.globalComponentIds.delete(component.componentId)

    if (!component.projectId) {
      return
    }

    const projectComponents =
      this.componentIdsByProjectId.get(component.projectId) ?? new Set<string>()

    projectComponents.add(component.componentId)
    this.componentIdsByProjectId.set(component.projectId, projectComponents)
  }
}
