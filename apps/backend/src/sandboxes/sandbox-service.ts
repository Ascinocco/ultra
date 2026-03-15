import type { ProjectId, SandboxContextSnapshot } from "@ultra/shared"

import type { SandboxPersistenceService } from "./sandbox-persistence-service.js"

export class SandboxService {
  constructor(private readonly persistenceService: SandboxPersistenceService) {}

  list(projectId: ProjectId): { sandboxes: SandboxContextSnapshot[] } {
    return {
      sandboxes: this.persistenceService.listSandboxes(projectId),
    }
  }

  getActive(projectId: ProjectId): SandboxContextSnapshot {
    return this.persistenceService.getActiveSandbox(projectId)
  }

  setActive(projectId: ProjectId, sandboxId: string): SandboxContextSnapshot {
    return this.persistenceService.setActiveSandbox(projectId, sandboxId)
  }

  resolveThreadSandbox(
    projectId: ProjectId,
    threadId: string,
  ): SandboxContextSnapshot | null {
    return this.persistenceService.findThreadSandbox(projectId, threadId)
  }
}
