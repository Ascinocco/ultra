import type {
  BackendCapabilities,
  BackendInfoSnapshot,
  CommandMethodName,
  QueryMethodName,
  SystemPingResult,
} from "@ultra/shared"
import {
  parseBackendInfoSnapshot,
  parseSystemHelloResult,
  parseSystemPingResult,
} from "@ultra/shared"

import type {
  BackendStatusListener,
  BackendStatusSnapshot,
} from "../shared/backend-status.js"
import { createInitialBackendStatus } from "../shared/backend-status.js"
import type { BackendProcessManager } from "./backend-process.js"
import { BackendSocketClient } from "./backend-socket-client.js"

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

export class BackendConnection {
  private readonly listeners = new Set<BackendStatusListener>()
  private status = createInitialBackendStatus()
  private activeHandshakePid: number | null = null
  private handshakeToken = 0

  constructor(
    private readonly processManager: BackendProcessManager,
    private readonly logger: Logger = console,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.processManager.subscribe((status) => {
      void this.handleProcessStatus(status)
    })
  }

  getStatus(): BackendStatusSnapshot {
    return { ...this.status }
  }

  subscribe(listener: BackendStatusListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())

    return () => {
      this.listeners.delete(listener)
    }
  }

  async ping(): Promise<SystemPingResult> {
    const response = await this.query("system.ping")

    return parseSystemPingResult(response)
  }

  async getBackendInfo(): Promise<BackendInfoSnapshot> {
    const response = await this.query("system.get_backend_info")

    return parseBackendInfoSnapshot(response)
  }

  async retryStartup(): Promise<BackendStatusSnapshot> {
    await this.processManager.restart()
    return this.getStatus()
  }

  async query(name: QueryMethodName, payload?: unknown): Promise<unknown> {
    const socketPath = this.status.socketPath

    if (!socketPath) {
      throw new Error("Backend socket path is not available.")
    }

    const client = new BackendSocketClient(socketPath, this.logger)
    const response = await client.query(name, payload ?? {})

    if (!response.ok) {
      throw new Error(response.error.message)
    }

    return response.result
  }

  async command(name: CommandMethodName, payload?: unknown): Promise<unknown> {
    const socketPath = this.status.socketPath

    if (!socketPath) {
      throw new Error("Backend socket path is not available.")
    }

    const client = new BackendSocketClient(socketPath, this.logger)
    const response = await client.command(name, payload ?? {})

    if (!response.ok) {
      throw new Error(response.error.message)
    }

    return response.result
  }

  private async handleProcessStatus(
    processStatus: BackendStatusSnapshot,
  ): Promise<void> {
    if (processStatus.phase === "starting") {
      this.updateStatus({
        ...processStatus,
        connectionStatus: "connecting",
        message: "Starting local backend…",
      })
      return
    }

    if (processStatus.phase === "running") {
      this.updateStatus({
        ...processStatus,
        connectionStatus: "connecting",
        message: "Waiting for backend handshake…",
      })

      if (
        processStatus.pid &&
        processStatus.socketPath &&
        processStatus.pid !== this.activeHandshakePid
      ) {
        this.activeHandshakePid = processStatus.pid
        void this.performHandshake(processStatus.pid, processStatus.socketPath)
      }

      return
    }

    this.activeHandshakePid = null
    this.handshakeToken += 1

    this.updateStatus({
      ...processStatus,
      sessionId: null,
      backendVersion: null,
      capabilities: null,
      connectionStatus:
        processStatus.phase === "degraded" ? "degraded" : "disconnected",
    })
  }

  private async performHandshake(
    pid: number,
    socketPath: string,
  ): Promise<void> {
    const token = ++this.handshakeToken
    const client = new BackendSocketClient(socketPath, this.logger)

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        const response = await client.query("system.hello")

        if (!response.ok) {
          throw new Error(response.error.message)
        }

        const hello = parseSystemHelloResult(response.result)

        if (
          token !== this.handshakeToken ||
          this.processManager.getStatus().pid !== pid
        ) {
          return
        }

        this.updateStatus({
          ...this.processManager.getStatus(),
          connectionStatus: "connected",
          message: `Connected to backend session ${hello.sessionId.slice(0, 8)}`,
          sessionId: hello.sessionId,
          backendVersion: hello.backendVersion,
          capabilities: hello.capabilities,
        })

        return
      } catch (error) {
        if (
          token !== this.handshakeToken ||
          this.processManager.getStatus().pid !== pid
        ) {
          return
        }

        if (attempt === 8) {
          const messageText =
            error instanceof Error ? error.message : String(error)

          this.updateStatus({
            ...this.processManager.getStatus(),
            phase: "degraded",
            connectionStatus: "degraded",
            message: `Handshake failed: ${messageText}`,
            sessionId: null,
            backendVersion: null,
            capabilities: null,
          })
          return
        }

        this.updateStatus({
          ...this.processManager.getStatus(),
          connectionStatus: "connecting",
          message: "Waiting for backend handshake…",
        })

        await new Promise((resolve) => {
          setTimeout(resolve, 150)
        })
      }
    }
  }

  private updateStatus(
    partial: BackendStatusSnapshot & {
      sessionId?: string | null
      backendVersion?: string | null
      capabilities?: BackendCapabilities | null
    },
  ): void
  private updateStatus(
    partial: Partial<
      BackendStatusSnapshot & {
        sessionId?: string | null
        backendVersion?: string | null
        capabilities?: BackendCapabilities | null
      }
    >,
  ): void
  private updateStatus(
    partial: Partial<
      BackendStatusSnapshot & {
        sessionId?: string | null
        backendVersion?: string | null
        capabilities?: BackendCapabilities | null
      }
    >,
  ): void {
    this.status = {
      ...this.status,
      ...partial,
      updatedAt: partial.updatedAt ?? this.now(),
    }

    for (const listener of this.listeners) {
      listener(this.getStatus())
    }
  }
}
