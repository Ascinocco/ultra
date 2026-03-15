import type {
  ProjectId,
  SandboxContextSnapshot,
  TerminalGetRuntimeProfileInput,
  TerminalRuntimeProfileResult,
  TerminalSyncRuntimeFilesInput,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import type { SandboxService } from "../sandboxes/sandbox-service.js"
import type { RuntimeProfileService } from "./runtime-profile-service.js"
import type { RuntimeSyncService } from "./runtime-sync-service.js"

export class TerminalService {
  constructor(
    private readonly sandboxService: SandboxService,
    private readonly runtimeProfileService: RuntimeProfileService,
    private readonly runtimeSyncService: RuntimeSyncService,
  ) {}

  getRuntimeProfile(
    input: TerminalGetRuntimeProfileInput,
  ): TerminalRuntimeProfileResult {
    const sandbox = this.resolveSandbox(input.project_id, input.sandbox_id)
    const runtimeProfile = this.runtimeProfileService.resolve(input.project_id)
    const sync = this.runtimeSyncService.refreshRuntimeSync(
      sandbox,
      runtimeProfile,
    )

    return {
      sandbox,
      profile: runtimeProfile.profile,
      sync,
    }
  }

  syncRuntimeFiles(
    input: TerminalSyncRuntimeFilesInput,
  ): TerminalRuntimeProfileResult {
    const sandbox = this.resolveSandbox(input.project_id, input.sandbox_id)
    const runtimeProfile = this.runtimeProfileService.resolve(input.project_id)
    const sync = this.runtimeSyncService.syncRuntimeFiles(
      sandbox,
      runtimeProfile,
      input.force ?? false,
    )

    return {
      sandbox,
      profile: runtimeProfile.profile,
      sync,
    }
  }

  syncRuntimeFilesForActivation(projectId: ProjectId, sandboxId: string): void {
    void this.syncRuntimeFiles({
      project_id: projectId,
      sandbox_id: sandboxId,
      force: false,
    })
  }

  private resolveSandbox(
    projectId: ProjectId,
    sandboxId?: string,
  ): SandboxContextSnapshot {
    if (!sandboxId) {
      return this.sandboxService.getActive(projectId)
    }

    const sandbox = this.sandboxService
      .list(projectId)
      .sandboxes.find((candidate) => candidate.sandboxId === sandboxId)

    if (!sandbox) {
      throw new IpcProtocolError(
        "not_found",
        `Sandbox not found for project: ${sandboxId}`,
      )
    }

    return sandbox
  }
}
