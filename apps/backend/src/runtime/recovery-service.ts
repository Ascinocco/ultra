import type { ProjectId } from "@ultra/shared"

import type { ProjectService } from "../projects/project-service.js"
import type { ThreadService } from "../threads/thread-service.js"
import type { CoordinatorService } from "./coordinator-service.js"
import type { RuntimeRegistry } from "./runtime-registry.js"
import type { WatchService } from "./watch-service.js"
import type { WatchdogService } from "./watchdog-service.js"

type RecoveryContext = {
  affectedThreadIds: string[]
  coordinatorInstanceId: string | null
  coordinatorReason: string | null
  projectRuntimeStatus: string | null
}

function isPausedRuntimeStatus(status: string | null): boolean {
  return status?.toLowerCase() === "paused"
}

export class RecoveryService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly threadService: ThreadService,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly coordinatorService: CoordinatorService,
    private readonly watchdogService: WatchdogService,
    private readonly watchService: WatchService,
  ) {}

  async recover(): Promise<void> {
    this.watchService.ensureRunning()

    for (const projectId of this.collectRecoveryCandidateProjectIds()) {
      await this.recoverProject(projectId)
    }
  }

  private collectRecoveryCandidateProjectIds(): ProjectId[] {
    const projectIds = new Set<ProjectId>()

    for (const runtime of this.runtimeRegistry.listAllProjectRuntimeSnapshots()) {
      if (runtime.status !== "idle") {
        projectIds.add(runtime.projectId)
      }
    }

    for (const project of this.projectService.list().projects) {
      if (
        this.runtimeRegistry.listProjectRuntimeComponents(project.id).length > 0
      ) {
        projectIds.add(project.id)
      }
    }

    for (const projectId of this.threadService.listProjectsWithNonTerminalThreads()) {
      projectIds.add(projectId)
    }

    return [...projectIds]
  }

  private async recoverProject(projectId: ProjectId): Promise<void> {
    const context = this.captureRecoveryContext(projectId)

    try {
      await this.coordinatorService.ensureReady(projectId)

      const recoveredRuntime =
        this.runtimeRegistry.getProjectRuntimeSnapshot(projectId)
      const recoveredCoordinator =
        this.runtimeRegistry.getProjectRuntimeComponent(
          projectId,
          "coordinator",
        )

      if (
        context.coordinatorInstanceId &&
        recoveredRuntime.coordinatorInstanceId &&
        context.coordinatorInstanceId !== recoveredRuntime.coordinatorInstanceId
      ) {
        for (const threadId of context.affectedThreadIds) {
          this.threadService.appendProjectedEvent({
            actorType: "backend",
            eventType: "thread.coordinator_restarted",
            payload: {
              new_instance_id: recoveredRuntime.coordinatorInstanceId,
              previous_instance_id: context.coordinatorInstanceId,
              reason:
                context.coordinatorReason ??
                "Coordinator recovered after backend restart.",
              restart_count:
                recoveredCoordinator?.restartCount ??
                recoveredRuntime.restartCount,
            },
            projectId,
            source: "ultra.runtime",
            threadId,
          })
        }
      }

      for (const threadId of context.affectedThreadIds) {
        this.coordinatorService.replayThread(
          this.threadService.getThread(threadId),
        )
      }

      if (isPausedRuntimeStatus(context.projectRuntimeStatus)) {
        this.coordinatorService.pauseProjectRuntime({
          project_id: projectId,
        })
      }

      for (const threadId of context.affectedThreadIds) {
        this.threadService.appendProjectedEvent({
          actorType: "backend",
          eventType: "thread.recovered",
          payload: {
            recovery_type: "backend_restart",
            summary:
              "Recovered the thread runtime relationship after backend restart.",
          },
          projectId,
          source: "ultra.runtime",
          threadId,
        })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      this.watchdogService.handleCoordinatorUnavailable(projectId, reason)

      for (const threadId of context.affectedThreadIds) {
        this.threadService.appendProjectedEvent({
          actorType: "backend",
          eventType: "thread.recovery_failed",
          payload: {
            reason,
            recovery_type: "backend_restart",
            summary:
              "Failed to restore the thread runtime relationship after backend restart.",
          },
          projectId,
          source: "ultra.runtime",
          threadId,
        })
      }
    }
  }

  private captureRecoveryContext(projectId: ProjectId): RecoveryContext {
    const affectedThreadIds =
      this.threadService.listNonTerminalThreadIds(projectId)
    const coordinator = this.runtimeRegistry.getProjectRuntimeComponent(
      projectId,
      "coordinator",
    )
    const runtime = this.runtimeRegistry.ensureProjectRuntime(projectId)

    return {
      affectedThreadIds,
      coordinatorInstanceId: runtime.coordinatorInstanceId,
      coordinatorReason: coordinator?.reason ?? null,
      projectRuntimeStatus: runtime.status,
    }
  }
}
