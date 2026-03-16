import type {
  ProjectId,
  SavedCommandId,
  TerminalSessionSnapshot,
} from "@ultra/shared"

import type { PtySessionHandle } from "./pty-adapter.js"

const RECENT_OUTPUT_LIMIT = 16_384
const CAPTURE_OUTPUT_LIMIT = 262_144

function cloneSession(
  session: TerminalSessionSnapshot,
): TerminalSessionSnapshot {
  return { ...session }
}

function orderSessions(
  sessions: TerminalSessionSnapshot[],
): TerminalSessionSnapshot[] {
  return [...sessions].sort((left, right) => {
    // Pinned tabs sort before unpinned
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1
    }

    const leftRunning = left.status === "running" || left.status === "starting"
    const rightRunning =
      right.status === "running" || right.status === "starting"

    if (leftRunning !== rightRunning) {
      return leftRunning ? -1 : 1
    }

    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

export class TerminalSessionRegistry {
  private readonly captureOutputBySessionId = new Map<string, string>()
  private readonly handlesBySessionId = new Map<string, PtySessionHandle>()
  private readonly sessionsByProjectId = new Map<
    ProjectId,
    Map<string, TerminalSessionSnapshot>
  >()

  addSession(
    session: TerminalSessionSnapshot,
    handle: PtySessionHandle,
  ): TerminalSessionSnapshot {
    const projectSessions =
      this.sessionsByProjectId.get(session.projectId) ?? new Map()

    projectSessions.set(session.sessionId, cloneSession(session))
    this.sessionsByProjectId.set(session.projectId, projectSessions)
    this.captureOutputBySessionId.set(session.sessionId, "")
    this.handlesBySessionId.set(session.sessionId, handle)

    return this.getRequiredSession(session.projectId, session.sessionId)
  }

  appendOutput(
    projectId: ProjectId,
    sessionId: string,
    chunk: string,
    occurredAt: string,
  ): TerminalSessionSnapshot {
    const current = this.getRequiredSession(projectId, sessionId)
    const recentOutput = `${current.recentOutput}${chunk}`.slice(
      -RECENT_OUTPUT_LIMIT,
    )
    const captureOutput =
      `${this.captureOutputBySessionId.get(sessionId) ?? ""}${chunk}`.slice(
        -CAPTURE_OUTPUT_LIMIT,
      )

    this.captureOutputBySessionId.set(sessionId, captureOutput)

    return this.updateSession(projectId, sessionId, {
      lastOutputAt: occurredAt,
      lastOutputSequence: current.lastOutputSequence + 1,
      recentOutput,
      updatedAt: occurredAt,
    })
  }

  closeAll(): void {
    for (const handle of this.handlesBySessionId.values()) {
      handle.kill()
    }

    this.captureOutputBySessionId.clear()
    this.handlesBySessionId.clear()
    this.sessionsByProjectId.clear()
  }

  getCaptureOutput(projectId: ProjectId, sessionId: string): string {
    this.getRequiredSession(projectId, sessionId)
    return this.captureOutputBySessionId.get(sessionId) ?? ""
  }

  getHandle(projectId: ProjectId, sessionId: string): PtySessionHandle {
    this.getRequiredSession(projectId, sessionId)
    const handle = this.handlesBySessionId.get(sessionId)

    if (!handle) {
      throw new Error(`Terminal session is not live: ${sessionId}`)
    }

    return handle
  }

  getRequiredSession(
    projectId: ProjectId,
    sessionId: string,
  ): TerminalSessionSnapshot {
    const session = this.sessionsByProjectId.get(projectId)?.get(sessionId)

    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`)
    }

    return cloneSession(session)
  }

  listSessions(projectId: ProjectId): TerminalSessionSnapshot[] {
    return orderSessions(
      [...(this.sessionsByProjectId.get(projectId)?.values() ?? [])].map(
        cloneSession,
      ),
    )
  }

  markExited(
    projectId: ProjectId,
    sessionId: string,
    exitCode: number,
    occurredAt: string,
  ): TerminalSessionSnapshot {
    this.handlesBySessionId.delete(sessionId)

    return this.updateSession(projectId, sessionId, {
      exitCode,
      status: exitCode === 0 ? "exited" : "failed",
      updatedAt: occurredAt,
    })
  }

  releaseHandle(sessionId: string): void {
    this.handlesBySessionId.delete(sessionId)
  }

  updateSession(
    projectId: ProjectId,
    sessionId: string,
    patch: Partial<TerminalSessionSnapshot>,
  ): TerminalSessionSnapshot {
    const projectSessions = this.sessionsByProjectId.get(projectId)
    const current = projectSessions?.get(sessionId)

    if (!projectSessions || !current) {
      throw new Error(`Terminal session not found: ${sessionId}`)
    }

    const nextSession = {
      ...current,
      ...patch,
    }

    projectSessions.set(sessionId, nextSession)
    return cloneSession(nextSession)
  }

  findReusableSavedCommand(
    projectId: ProjectId,
    sandboxId: string,
    commandId: SavedCommandId,
  ): TerminalSessionSnapshot | null {
    return (
      this.listSessions(projectId).find(
        (session) =>
          session.status === "running" &&
          session.sessionKind === "saved_command" &&
          session.sandboxId === sandboxId &&
          session.commandId === commandId,
      ) ?? null
    )
  }

  findReusableShell(
    projectId: ProjectId,
    sandboxId: string,
  ): TerminalSessionSnapshot | null {
    return (
      this.listSessions(projectId).find(
        (session) =>
          session.status === "running" &&
          session.sessionKind === "shell" &&
          session.sandboxId === sandboxId,
      ) ?? null
    )
  }
}
