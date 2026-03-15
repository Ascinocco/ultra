import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"

import type {
  BackendStatusListener,
  BackendStatusSnapshot,
} from "../shared/backend-status.js"
import { createInitialBackendStatus } from "../shared/backend-status.js"
import type { BackendLaunchConfig } from "./backend-config.js"

type ManagedChildProcess = Pick<
  ChildProcess,
  "kill" | "on" | "once" | "pid" | "stderr" | "stdout"
>

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ManagedChildProcess

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

type BackendProcessManagerOptions = {
  config: BackendLaunchConfig
  spawnProcess?: SpawnProcess
  now?: () => string
  logger?: Logger
}

const READY_MARKERS = ["backend scaffold ready", "backend ready"]

export class BackendProcessManager {
  private readonly config: BackendLaunchConfig
  private readonly spawnProcess: SpawnProcess
  private readonly now: () => string
  private readonly logger: Logger
  private readonly listeners = new Set<BackendStatusListener>()

  private child: ManagedChildProcess | null = null
  private readinessTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private stopPromise: Promise<void> | null = null
  private isStopping = false
  private status = createInitialBackendStatus()

  constructor(options: BackendProcessManagerOptions) {
    this.config = options.config
    this.spawnProcess = options.spawnProcess ?? spawn
    this.now = options.now ?? (() => new Date().toISOString())
    this.logger = options.logger ?? console
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

  start(): void {
    if (this.child || this.restartTimer) {
      return
    }

    this.isStopping = false
    this.spawnBackend("Starting local backend…")
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise
    }

    this.isStopping = true
    this.clearRestartTimer()
    this.clearReadinessTimer()

    if (!this.child) {
      this.updateStatus({
        phase: "stopped",
        connectionStatus: "disconnected",
        message: "Local backend stopped.",
        pid: null,
      })
      return
    }

    const child = this.child
    const exitPromise = new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve()
      })
    })

    child.kill("SIGTERM")

    this.stopPromise = Promise.race([
      exitPromise,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (this.child === child) {
            child.kill("SIGKILL")
          }

          resolve()
        }, this.config.shutdownTimeoutMs)
      }),
    ]).finally(() => {
      this.stopPromise = null
    })

    await this.stopPromise
  }

  private spawnBackend(message: string): void {
    this.updateStatus({
      phase: this.status.restartCount > 0 ? "degraded" : "starting",
      connectionStatus:
        this.status.restartCount > 0 ? "degraded" : "connecting",
      message,
    })

    this.logger.info(
      `[desktop] launching backend: ${this.config.command} ${this.config.args.join(" ")}`,
    )

    let child: ManagedChildProcess

    try {
      child = this.spawnProcess(this.config.command, this.config.args, {
        cwd: this.config.cwd,
        env: this.config.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)

      this.updateStatus({
        phase: "failed",
        connectionStatus: "disconnected",
        message: `Backend failed to launch: ${messageText}`,
        pid: null,
      })

      return
    }

    this.child = child

    this.updateStatus({
      pid: child.pid ?? null,
      socketPath: this.config.socketPath,
      updatedAt: this.now(),
    })

    child.stdout?.on("data", (chunk) => {
      const messageText = chunk.toString().trim()

      if (!messageText) {
        return
      }

      this.logger.info(`[backend:stdout] ${messageText}`)

      if (
        READY_MARKERS.some((marker) =>
          messageText.toLowerCase().includes(marker),
        )
      ) {
        this.markRunning("Local backend running.")
      }
    })

    child.stderr?.on("data", (chunk) => {
      const messageText = chunk.toString().trim()

      if (!messageText) {
        return
      }

      this.logger.error(`[backend:stderr] ${messageText}`)

      if (this.status.phase === "starting") {
        this.updateStatus({
          message: `Backend reported an error while starting: ${messageText}`,
        })
      }
    })

    child.once("error", (error) => {
      this.clearReadinessTimer()

      const messageText = error instanceof Error ? error.message : String(error)

      this.updateStatus({
        phase: "failed",
        connectionStatus: "disconnected",
        message: `Backend process error: ${messageText}`,
        pid: null,
      })

      this.child = null
    })

    child.once("exit", (code, signal) => {
      this.handleExit(code, signal)
    })

    this.clearReadinessTimer()
    this.readinessTimer = setTimeout(() => {
      if (this.child === child) {
        this.markRunning("Local backend running.")
      }
    }, this.config.startupGraceMs)
  }

  private markRunning(message: string): void {
    if (!this.child) {
      return
    }

    this.clearReadinessTimer()
    this.updateStatus({
      phase: "running",
      connectionStatus: "connected",
      message,
      pid: this.child.pid ?? null,
      socketPath: this.config.socketPath,
    })
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const previousChild = this.child

    this.child = null
    this.clearReadinessTimer()

    if (this.isStopping) {
      this.updateStatus({
        phase: "stopped",
        connectionStatus: "disconnected",
        message: "Local backend stopped.",
        pid: null,
        lastExitCode: code,
        lastSignal: signal,
      })

      return
    }

    const nextRestartCount = this.status.restartCount + 1
    const reason = `Backend exited (code: ${code ?? "null"}, signal: ${signal ?? "null"})`

    this.logger.error(`[desktop] ${reason}`)

    if (!previousChild || nextRestartCount > this.config.maxRestartAttempts) {
      this.updateStatus({
        phase: "failed",
        connectionStatus: "disconnected",
        message: `Backend exited unexpectedly and retries were exhausted. ${reason}`,
        pid: null,
        restartCount: Math.min(
          nextRestartCount,
          this.config.maxRestartAttempts,
        ),
        lastExitCode: code,
        lastSignal: signal,
      })

      return
    }

    this.updateStatus({
      phase: "degraded",
      connectionStatus: "degraded",
      message: `Backend exited unexpectedly. Restarting (${nextRestartCount}/${this.config.maxRestartAttempts})…`,
      pid: null,
      restartCount: nextRestartCount,
      lastExitCode: code,
      lastSignal: signal,
    })

    this.clearRestartTimer()
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnBackend("Restarting local backend…")
    }, this.config.restartDelayMs)
  }

  private clearReadinessTimer(): void {
    if (this.readinessTimer) {
      clearTimeout(this.readinessTimer)
      this.readinessTimer = null
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private updateStatus(
    partial: Partial<BackendStatusSnapshot> &
      Pick<BackendStatusSnapshot, "message">,
  ): void
  private updateStatus(partial: Partial<BackendStatusSnapshot>): void
  private updateStatus(partial: Partial<BackendStatusSnapshot>): void {
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
