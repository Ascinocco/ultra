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

export type ResolvedRuntimeContext = {
  profile: ReturnType<RuntimeProfileService["resolve"]>["profile"]
  sandbox: SandboxContextSnapshot
}

export type EnsuredRuntimeContext = ResolvedRuntimeContext & {
  sync: TerminalRuntimeProfileResult["sync"]
}

export class TerminalService {
  constructor(
    private readonly sandboxService: SandboxService,
    private readonly runtimeProfileService: RuntimeProfileService,
    private readonly runtimeSyncService: RuntimeSyncService,
  ) {}

  getRuntimeProfile(
    input: TerminalGetRuntimeProfileInput,
  ): TerminalRuntimeProfileResult {
    const { sandbox, profile } = this.resolveRuntimeContext(
      input.project_id,
      input.sandbox_id,
    )
    const sync = this.runtimeSyncService.refreshRuntimeSync(
      sandbox,
      this.runtimeProfileService.resolve(input.project_id),
    )

    return {
      sandbox,
      profile,
      sync,
    }
  }

  syncRuntimeFiles(
    input: TerminalSyncRuntimeFilesInput,
  ): TerminalRuntimeProfileResult {
    const { sandbox, profile } = this.resolveRuntimeContext(
      input.project_id,
      input.sandbox_id,
    )
    const runtimeProfile = this.runtimeProfileService.resolve(input.project_id)
    const sync = this.runtimeSyncService.syncRuntimeFiles(
      sandbox,
      runtimeProfile,
      input.force ?? false,
    )

    return {
      sandbox,
      profile,
      sync,
    }
  }

  ensureRuntimeContext(
    projectId: ProjectId,
    sandboxId?: string,
  ): EnsuredRuntimeContext {
    const { sandbox, profile } = this.resolveRuntimeContext(
      projectId,
      sandboxId,
    )
    const sync = this.runtimeSyncService.syncRuntimeFiles(
      sandbox,
      this.runtimeProfileService.resolve(projectId),
      false,
    )

    return {
      sandbox,
      profile,
      sync,
    }
  }

  resolveRuntimeContext(
    projectId: ProjectId,
    sandboxId?: string,
  ): ResolvedRuntimeContext {
    const runtimeProfile = this.runtimeProfileService.resolve(projectId)

    return {
      sandbox: this.resolveSandbox(projectId, sandboxId),
      profile: runtimeProfile.profile,
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

    const sandbox = this.sandboxService.getSandbox(projectId, sandboxId)

    return sandbox
  }
}
