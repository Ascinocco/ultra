import type {
  ArtifactSnapshot,
  ArtifactsCaptureRuntimeInput,
  RuntimeOutputBundle,
  SandboxContextSnapshot,
  TerminalOutputBundle,
  TerminalSessionSnapshot,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import type { SandboxService } from "../sandboxes/sandbox-service.js"
import type { TerminalSessionService } from "../terminal/terminal-session-service.js"
import type { ArtifactStorageService } from "./artifact-storage-service.js"

type CaptureContext = {
  captureOutput: string
  session: TerminalSessionSnapshot
}

export class ArtifactCaptureService {
  constructor(
    private readonly artifactStorageService: ArtifactStorageService,
    private readonly sandboxService: SandboxService,
    private readonly terminalSessionService: TerminalSessionService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  captureRuntime(input: ArtifactsCaptureRuntimeInput): ArtifactSnapshot {
    const captureContext = this.terminalSessionService.getCaptureContext(
      input.project_id,
      input.session_id,
    )
    const sandbox = this.sandboxService.getSandbox(
      input.project_id,
      captureContext.session.sandboxId,
    )

    if (!sandbox.threadId) {
      throw new IpcProtocolError(
        "invalid_request",
        "Runtime artifact capture currently requires a thread-backed sandbox session.",
      )
    }

    const bundle =
      captureContext.session.sessionKind === "saved_command"
        ? this.buildRuntimeBundle(captureContext, sandbox)
        : this.buildTerminalBundle(captureContext, sandbox)

    return this.artifactStorageService.storeArtifact({
      projectId: input.project_id,
      threadId: sandbox.threadId,
      bundle,
    })
  }

  private buildRuntimeBundle(
    context: CaptureContext,
    sandbox: SandboxContextSnapshot,
  ): RuntimeOutputBundle {
    const label =
      context.session.commandLabel ?? context.session.commandId ?? "runtime"

    return {
      artifactType: "runtime_output_bundle",
      title: `${label} output`,
      summary: `Captured ${label.toLowerCase()} output from ${sandbox.displayName} (${context.session.status})`,
      capturedAt: this.now(),
      source: {
        surface: "runtime",
        metadata: this.buildSourceMetadata(context.session, sandbox),
      },
      payload: {
        processType: context.session.commandId ?? "runtime",
        command: context.session.commandLine,
        cwd: context.session.cwd,
        exitCode: context.session.exitCode,
        terminalOutput: context.captureOutput,
        debugOutput: null,
      },
      largeContentRefs: [],
    }
  }

  private buildTerminalBundle(
    context: CaptureContext,
    sandbox: SandboxContextSnapshot,
  ): TerminalOutputBundle {
    return {
      artifactType: "terminal_output_bundle",
      title: `Terminal output - ${sandbox.displayName}`,
      summary: `Captured shell output from ${sandbox.displayName} (${context.session.status})`,
      capturedAt: this.now(),
      source: {
        surface: "terminal",
        metadata: this.buildSourceMetadata(context.session, sandbox),
      },
      payload: {
        command: context.session.commandLine,
        cwd: context.session.cwd,
        exitCode: context.session.exitCode,
        output: context.captureOutput,
      },
      largeContentRefs: [],
    }
  }

  private buildSourceMetadata(
    session: TerminalSessionSnapshot,
    sandbox: SandboxContextSnapshot,
  ): Record<string, unknown> {
    return {
      sessionId: session.sessionId,
      sessionKind: session.sessionKind,
      commandId: session.commandId,
      commandLabel: session.commandLabel,
      sandboxId: sandbox.sandboxId,
      sandboxDisplayName: sandbox.displayName,
      threadId: sandbox.threadId,
      status: session.status,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      lastOutputAt: session.lastOutputAt,
    }
  }
}
