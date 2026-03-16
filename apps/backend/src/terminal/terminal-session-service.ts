import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type {
  ProjectId,
  SavedCommandId,
  SavedCommandSnapshot,
  TerminalCloseSessionInput,
  TerminalListSavedCommandsInput,
  TerminalListSavedCommandsResult,
  TerminalListSessionsInput,
  TerminalListSessionsResult,
  TerminalOpenInput,
  TerminalOutputEventPayload,
  TerminalResizeSessionInput,
  TerminalRunSavedCommandInput,
  TerminalSessionSnapshot,
  TerminalWriteInputInput,
} from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import {
  getDefaultShellCommand,
  NodePtyAdapter,
  type PtyAdapter,
} from "./pty-adapter.js"
import type { RuntimeProfileService } from "./runtime-profile-service.js"
import type { TerminalService } from "./terminal-service.js"
import { TerminalSessionRegistry } from "./terminal-session-registry.js"

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 30
const SUBSCRIBED_COMMANDS = ["test", "dev", "lint", "build"] as const

type SessionsListener = (projectId: ProjectId) => void
type OutputListener = (payload: TerminalOutputEventPayload) => void

type PackageManagerName = "bun" | "npm" | "pnpm" | "yarn"

type PackageManifest = {
  packageManager?: string
  scripts?: Record<string, string>
}

type ResolvedSavedCommand = {
  command: string
  commandId: SavedCommandId
  commandLine: string
  isAvailable: boolean
  label: string
  reasonUnavailable: string | null
  runner: PackageManagerName
}

function buildRunnerCommand(runner: PackageManagerName): string {
  if (process.platform === "win32") {
    return `${runner}.cmd`
  }

  return runner
}

function buildSavedCommandLine(
  runner: PackageManagerName,
  commandId: SavedCommandId,
): { args: string[]; command: string; commandLine: string } {
  switch (runner) {
    case "bun":
      return {
        command: buildRunnerCommand("bun"),
        args: ["run", commandId],
        commandLine: `bun run ${commandId}`,
      }
    case "npm":
      return {
        command: buildRunnerCommand("npm"),
        args: ["run", commandId],
        commandLine: `npm run ${commandId}`,
      }
    case "pnpm":
      return {
        command: buildRunnerCommand("pnpm"),
        args: ["run", commandId],
        commandLine: `pnpm run ${commandId}`,
      }
    case "yarn":
      return {
        command: buildRunnerCommand("yarn"),
        args: [commandId],
        commandLine: `yarn ${commandId}`,
      }
  }
}

function detectPackageManager(manifest: PackageManifest): PackageManagerName {
  const packageManager = manifest.packageManager?.split("@")[0]

  switch (packageManager) {
    case "bun":
    case "npm":
    case "pnpm":
    case "yarn":
      return packageManager
    default:
      return "npm"
  }
}

function readPackageManifest(projectRootPath: string): PackageManifest | null {
  try {
    const manifest = readFileSync(join(projectRootPath, "package.json"), "utf8")
    return JSON.parse(manifest) as PackageManifest
  } catch {
    return null
  }
}

function buildSessionTitle(
  sandboxDisplayName: string,
  input: {
    commandLabel: string | null
    sessionKind: TerminalSessionSnapshot["sessionKind"]
    threadId: string | null
  },
): string {
  const prefix =
    input.sessionKind === "shell"
      ? sandboxDisplayName
      : `${input.commandLabel ?? "Command"} - ${sandboxDisplayName}`

  if (!input.threadId) {
    return prefix
  }

  return `${prefix} (${input.threadId})`
}

function toSavedCommandLabel(commandId: SavedCommandId): string {
  switch (commandId) {
    case "build":
      return "Build"
    case "dev":
      return "Dev"
    case "lint":
      return "Lint"
    case "test":
      return "Test"
  }
}

export class TerminalSessionService {
  private readonly outputListeners = new Set<OutputListener>()
  private readonly registry: TerminalSessionRegistry
  private readonly sessionsListeners = new Set<SessionsListener>()

  constructor(
    private readonly terminalService: TerminalService,
    private readonly runtimeProfileService: RuntimeProfileService,
    private readonly ptyAdapter: PtyAdapter = new NodePtyAdapter(),
    registry: TerminalSessionRegistry = new TerminalSessionRegistry(),
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.registry = registry
  }

  closeSession(input: TerminalCloseSessionInput): null {
    const session = this.getRequiredSession(input.project_id, input.session_id)
    const liveHandle = this.tryGetLiveHandle(
      session.projectId,
      session.sessionId,
    )

    if (liveHandle) {
      liveHandle.kill()
    }

    return null
  }

  dispose(): void {
    this.registry.closeAll()
  }

  listSavedCommands(
    input: TerminalListSavedCommandsInput,
  ): TerminalListSavedCommandsResult {
    const projectRootPath = this.runtimeProfileService.resolve(
      input.project_id,
    ).projectRootPath

    return {
      commands: this.resolveSavedCommands(projectRootPath),
    }
  }

  listSessions(input: TerminalListSessionsInput): TerminalListSessionsResult {
    return {
      sessions: this.registry.listSessions(input.project_id),
    }
  }

  open(input: TerminalOpenInput): TerminalSessionSnapshot {
    const runtimeContext = this.terminalService.ensureRuntimeContext(
      input.project_id,
      input.sandbox_id,
    )
    const existing = this.registry.findReusableShell(
      runtimeContext.sandbox.projectId,
      runtimeContext.sandbox.sandboxId,
    )

    if (existing) {
      const reused = this.registry.updateSession(
        existing.projectId,
        existing.sessionId,
        {
          updatedAt: this.now(),
        },
      )

      this.publishSessions(reused.projectId)
      return reused
    }

    return this.createSession({
      projectId: runtimeContext.sandbox.projectId,
      sandbox: runtimeContext.sandbox,
      command: getDefaultShellCommand(),
      args: [],
      commandId: null,
      commandLabel: null,
      commandLine: getDefaultShellCommand(),
      ...(input.cols ? { cols: input.cols } : {}),
      ...(input.rows ? { rows: input.rows } : {}),
      sessionKind: "shell",
    })
  }

  resizeSession(input: TerminalResizeSessionInput): null {
    const handle = this.getLiveHandle(input.project_id, input.session_id)
    handle.resize(input.cols, input.rows)
    return null
  }

  runSavedCommand(
    input: TerminalRunSavedCommandInput,
  ): TerminalSessionSnapshot {
    const runtimeContext = this.terminalService.ensureRuntimeContext(
      input.project_id,
      input.sandbox_id,
    )
    const existing = this.registry.findReusableSavedCommand(
      runtimeContext.sandbox.projectId,
      runtimeContext.sandbox.sandboxId,
      input.command_id,
    )

    if (existing) {
      const reused = this.registry.updateSession(
        existing.projectId,
        existing.sessionId,
        {
          updatedAt: this.now(),
        },
      )

      this.publishSessions(reused.projectId)
      return reused
    }

    const command = this.requireSavedCommand(input.project_id, input.command_id)

    return this.createSession({
      projectId: runtimeContext.sandbox.projectId,
      sandbox: runtimeContext.sandbox,
      command: command.command,
      args: command.args,
      commandId: input.command_id,
      commandLabel: toSavedCommandLabel(input.command_id),
      commandLine: command.commandLine,
      ...(input.cols ? { cols: input.cols } : {}),
      ...(input.rows ? { rows: input.rows } : {}),
      sessionKind: "saved_command",
    })
  }

  subscribeToOutput(
    projectId: ProjectId,
    sessionId: string,
    listener: OutputListener,
  ): () => void {
    this.getRequiredSession(projectId, sessionId)
    const wrappedListener: OutputListener = (payload) => {
      if (
        payload.project_id === projectId &&
        payload.session_id === sessionId
      ) {
        listener(payload)
      }
    }

    this.outputListeners.add(wrappedListener)

    return () => {
      this.outputListeners.delete(wrappedListener)
    }
  }

  subscribeToSessions(
    projectId: ProjectId,
    listener: SessionsListener,
  ): () => void {
    const wrappedListener: SessionsListener = (updatedProjectId) => {
      if (updatedProjectId === projectId) {
        listener(updatedProjectId)
      }
    }

    this.sessionsListeners.add(wrappedListener)

    return () => {
      this.sessionsListeners.delete(wrappedListener)
    }
  }

  writeInput(input: TerminalWriteInputInput): null {
    const handle = this.getLiveHandle(input.project_id, input.session_id)
    handle.write(input.input)
    return null
  }

  getCaptureContext(
    projectId: ProjectId,
    sessionId: string,
  ): {
    captureOutput: string
    session: TerminalSessionSnapshot
  } {
    return {
      session: this.getRequiredSession(projectId, sessionId),
      captureOutput: this.registry.getCaptureOutput(projectId, sessionId),
    }
  }

  private createSession(input: {
    args: string[]
    cols?: number
    command: string
    commandId: SavedCommandId | null
    commandLabel: string | null
    commandLine: string
    projectId: ProjectId
    rows?: number
    sandbox: Awaited<
      ReturnType<TerminalService["ensureRuntimeContext"]>
    >["sandbox"]
    sessionKind: TerminalSessionSnapshot["sessionKind"]
  }): TerminalSessionSnapshot {
    const timestamp = this.now()
    const sessionId = `term_${randomUUID()}`
    const cols = input.cols ?? DEFAULT_COLS
    const rows = input.rows ?? DEFAULT_ROWS
    const handle = this.ptyAdapter.spawn({
      command: input.command,
      args: input.args,
      cols,
      rows,
      cwd: input.sandbox.path,
      env: this.environment,
    })
    const session = this.registry.addSession(
      {
        sessionId,
        projectId: input.projectId,
        sandboxId: input.sandbox.sandboxId,
        threadId: input.sandbox.threadId,
        cwd: input.sandbox.path,
        title: buildSessionTitle(input.sandbox.displayName, {
          sessionKind: input.sessionKind,
          commandLabel: input.commandLabel,
          threadId: input.sandbox.threadId,
        }),
        sessionKind: input.sessionKind,
        status: "running",
        commandId: input.commandId,
        commandLabel: input.commandLabel,
        commandLine: input.commandLine,
        exitCode: null,
        startedAt: timestamp,
        updatedAt: timestamp,
        lastOutputAt: null,
        lastOutputSequence: 0,
        recentOutput: "",
      },
      handle,
    )

    handle.onData((chunk) => {
      const nextSession = this.registry.appendOutput(
        session.projectId,
        session.sessionId,
        chunk,
        this.now(),
      )

      this.publishOutput({
        project_id: nextSession.projectId,
        session_id: nextSession.sessionId,
        sequence_number: nextSession.lastOutputSequence,
        chunk,
        occurred_at: nextSession.lastOutputAt ?? nextSession.updatedAt,
      })
    })
    handle.onExit((info) => {
      try {
        this.registry.markExited(
          session.projectId,
          session.sessionId,
          info.exitCode,
          this.now(),
        )
        this.publishSessions(session.projectId)
      } catch {
        // Session may already be cleaned up during shutdown.
      }
    })

    this.publishSessions(session.projectId)
    return session
  }

  private getLiveHandle(projectId: ProjectId, sessionId: string) {
    try {
      return this.registry.getHandle(projectId, sessionId)
    } catch {
      throw new IpcProtocolError(
        "not_found",
        `Terminal session is not running: ${sessionId}`,
      )
    }
  }

  private getRequiredSession(
    projectId: ProjectId,
    sessionId: string,
  ): TerminalSessionSnapshot {
    try {
      return this.registry.getRequiredSession(projectId, sessionId)
    } catch {
      throw new IpcProtocolError(
        "not_found",
        `Terminal session not found for project: ${sessionId}`,
      )
    }
  }

  private publishOutput(payload: TerminalOutputEventPayload): void {
    for (const listener of this.outputListeners) {
      listener(payload)
    }
  }

  private publishSessions(projectId: ProjectId): void {
    for (const listener of this.sessionsListeners) {
      listener(projectId)
    }
  }

  private requireSavedCommand(
    projectId: ProjectId,
    commandId: SavedCommandId,
  ): { args: string[]; command: string; commandLine: string } {
    const command = this.listSavedCommands({
      project_id: projectId,
    }).commands.find((candidate) => candidate.commandId === commandId)

    if (!command?.isAvailable) {
      throw new IpcProtocolError(
        "invalid_request",
        command?.reasonUnavailable ??
          `Saved command is not available: ${commandId}`,
      )
    }

    const runner = this.resolveRunner(projectId)

    return buildSavedCommandLine(runner, commandId)
  }

  private resolveRunner(projectId: ProjectId): PackageManagerName {
    const projectRootPath =
      this.runtimeProfileService.resolve(projectId).projectRootPath
    const manifest = readPackageManifest(projectRootPath)

    return manifest ? detectPackageManager(manifest) : "npm"
  }

  private resolveSavedCommands(
    projectRootPath: string,
  ): SavedCommandSnapshot[] {
    const manifest = readPackageManifest(projectRootPath)
    const runner = manifest ? detectPackageManager(manifest) : "npm"
    const scripts = manifest?.scripts ?? {}

    return SUBSCRIBED_COMMANDS.map((commandId) => {
      const resolved = this.toSavedCommand(runner, scripts, commandId)

      return {
        commandId: resolved.commandId,
        label: resolved.label,
        commandLine: resolved.commandLine,
        isAvailable: resolved.isAvailable,
        reasonUnavailable: resolved.reasonUnavailable,
      }
    })
  }

  private toSavedCommand(
    runner: PackageManagerName,
    scripts: Record<string, string>,
    commandId: SavedCommandId,
  ): ResolvedSavedCommand {
    const command = buildSavedCommandLine(runner, commandId)
    const isAvailable = typeof scripts[commandId] === "string"

    return {
      ...command,
      commandId,
      runner,
      label: toSavedCommandLabel(commandId),
      isAvailable,
      reasonUnavailable: isAvailable
        ? null
        : `Missing "${commandId}" script in project package.json.`,
    }
  }

  tryGetLiveHandle(projectId: ProjectId, sessionId: string) {
    try {
      return this.registry.getHandle(projectId, sessionId)
    } catch {
      return null
    }
  }
}
