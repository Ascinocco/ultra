import type { ProjectId, SandboxContextSnapshot } from "@ultra/shared"

import type { SandboxPersistenceService } from "./sandbox-persistence-service.js"

type ActivationSyncHandler = (projectId: ProjectId, sandboxId: string) => void

export class SandboxService {
  private activationSyncHandler: ActivationSyncHandler | null = null

  constructor(private readonly persistenceService: SandboxPersistenceService) {}

  setActivationSyncHandler(handler: ActivationSyncHandler): void {
    this.activationSyncHandler = handler
  }

  list(projectId: ProjectId): { sandboxes: SandboxContextSnapshot[] } {
    return {
      sandboxes: this.persistenceService.listSandboxes(projectId),
    }
  }

  getActive(projectId: ProjectId): SandboxContextSnapshot {
    return this.persistenceService.getActiveSandbox(projectId)
  }

  setActive(projectId: ProjectId, sandboxId: string): SandboxContextSnapshot {
    const sandbox = this.persistenceService.setActiveSandbox(
      projectId,
      sandboxId,
    )

    if (this.activationSyncHandler) {
      try {
        this.activationSyncHandler(projectId, sandboxId)
      } catch {
        // Activation should not fail just because runtime sync could not complete.
      }
    }

    return sandbox
  }

  resolveThreadSandbox(
    projectId: ProjectId,
    threadId: string,
  ): SandboxContextSnapshot | null {
    return this.persistenceService.findThreadSandbox(projectId, threadId)
  }
}
