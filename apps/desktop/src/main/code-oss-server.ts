import { type ChildProcess, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import type {
  EditorHostStatusListener,
  EditorHostStatusSnapshot,
} from "../shared/editor-host.js"
import { createInitialEditorHostStatus } from "../shared/editor-host.js"

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

type CodeOssServerOptions = {
  repoRoot: string
  runtimeDir: string
  logger?: Logger
  now?: () => string
}

type ManagedChild = Pick<
  ChildProcess,
  "kill" | "once" | "on" | "stdout" | "stderr"
>

function extractServerUrl(message: string): string | null {
  const matched = message.match(/https?:\/\/[^\s]+/i)
  return matched ? matched[0] : null
}

export class CodeOssServer {
  private readonly repoRoot: string
  private readonly runtimeDir: string
  private readonly logger: Logger
  private readonly listeners = new Set<EditorHostStatusListener>()
  private child: ManagedChild | null = null
  private status = createInitialEditorHostStatus()
  private currentWorkspacePath: string | null = null
  private startPromise: Promise<string> | null = null
  private lastStartupError: string | null = null

  constructor(options: CodeOssServerOptions) {
    this.repoRoot = options.repoRoot
    this.runtimeDir = options.runtimeDir
    this.logger = options.logger ?? console
  }

  getStatus(): EditorHostStatusSnapshot {
    return { ...this.status }
  }

  subscribe(listener: EditorHostStatusListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())

    return () => {
      this.listeners.delete(listener)
    }
  }

  async ensureRunning(workspacePath: string): Promise<string> {
    if (
      this.child &&
      this.status.phase === "ready" &&
      this.currentWorkspacePath === workspacePath &&
      this.status.serverUrl
    ) {
      return this.status.serverUrl
    }

    if (this.startPromise && this.currentWorkspacePath === workspacePath) {
      return this.startPromise
    }

    await this.stop()

    const vendorRoot = join(this.repoRoot, "vendor/code-oss")
    const serverEntry = join(vendorRoot, "out/server-main.js")

    if (!existsSync(vendorRoot)) {
      this.updateStatus({
        phase: "unavailable",
        message:
          "Code-OSS vendor workspace is missing. Run git submodule update --init --recursive.",
        workspacePath,
        serverUrl: null,
      })
      throw new Error(this.status.message)
    }

    if (!existsSync(serverEntry)) {
      this.updateStatus({
        phase: "unavailable",
        message:
          "Code-OSS host is not prepared. Run pnpm --filter @ultra/desktop editor-host:prepare.",
        workspacePath,
        serverUrl: null,
      })
      throw new Error(this.status.message)
    }

    this.currentWorkspacePath = workspacePath
    this.lastStartupError = null
    this.updateStatus({
      phase: "starting",
      message: `Starting Code-OSS host for ${basename(workspacePath)}…`,
      workspacePath,
      serverUrl: null,
    })

    this.startPromise = this.spawnServer(vendorRoot, serverEntry, workspacePath)

    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async stop(): Promise<void> {
    const child = this.child

    this.child = null

    if (!child) {
      this.updateStatus({
        phase: "idle",
        message: "Editor host idle.",
        workspacePath: null,
        serverUrl: null,
      })
      return
    }

    await new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL")
        resolvePromise()
      }, 1500)

      child.once("exit", () => {
        clearTimeout(timeout)
        resolvePromise()
      })

      child.kill("SIGTERM")
    })

    this.updateStatus({
      phase: "idle",
      message: "Editor host idle.",
      workspacePath: null,
      serverUrl: null,
    })
  }

  private async spawnServer(
    vendorRoot: string,
    serverEntry: string,
    workspacePath: string,
  ): Promise<string> {
    const serverDataDir = resolve(this.runtimeDir, "editor-host/server-data")
    const userDataDir = resolve(this.runtimeDir, "editor-host/user-data")
    const extensionsDir = resolve(this.runtimeDir, "editor-host/extensions")

    await Promise.all([
      mkdir(serverDataDir, { recursive: true }),
      mkdir(userDataDir, { recursive: true }),
      mkdir(extensionsDir, { recursive: true }),
    ])

    return await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(
        process.execPath,
        [
          serverEntry,
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--without-connection-token",
          "--accept-server-license-terms",
          "--disable-telemetry",
          "--disable-workspace-trust",
          "--server-data-dir",
          serverDataDir,
          "--user-data-dir",
          userDataDir,
          "--extensions-dir",
          extensionsDir,
          "--default-folder",
          workspacePath,
        ],
        {
          cwd: vendorRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )

      this.child = child

      const handleFailure = (message: string) => {
        if (this.child === child) {
          this.child = null
        }

        this.updateStatus({
          phase: "error",
          message,
          serverUrl: null,
        })
        rejectPromise(new Error(message))
      }

      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString().trim()

        if (!text) {
          return
        }

        this.logger.info(`[editor-host:stdout] ${text}`)

        const serverUrl = extractServerUrl(text)
        if (serverUrl) {
          this.updateStatus({
            phase: "ready",
            message: `Embedded editor ready for ${basename(workspacePath)}.`,
            workspacePath,
            serverUrl,
          })
          resolvePromise(serverUrl)
        }
      })

      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString().trim()

        if (!text) {
          return
        }

        this.lastStartupError = text
        this.logger.error(`[editor-host:stderr] ${text}`)
      })

      child.once("error", (error) => {
        handleFailure(
          `Failed to launch embedded Code-OSS host: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      })

      child.once("exit", (code, signal) => {
        if (this.child !== child) {
          return
        }

        this.child = null

        if (this.status.phase === "ready") {
          this.updateStatus({
            phase: "error",
            message: `Embedded editor host exited (code: ${code ?? "null"}, signal: ${signal ?? "null"}).`,
            serverUrl: null,
          })
          return
        }

        handleFailure(
          this.lastStartupError
            ? `Embedded editor host failed to start: ${this.lastStartupError}`
            : `Embedded editor host exited before becoming ready (code: ${code ?? "null"}, signal: ${signal ?? "null"}).`,
        )
      })
    })
  }

  private updateStatus(
    partial: Partial<EditorHostStatusSnapshot> &
      Pick<EditorHostStatusSnapshot, "message">,
  ): void
  private updateStatus(partial: Partial<EditorHostStatusSnapshot>): void
  private updateStatus(partial: Partial<EditorHostStatusSnapshot>): void {
    this.status = {
      ...this.status,
      ...partial,
      workspacePath: partial.workspacePath ?? this.status.workspacePath,
      serverUrl:
        partial.serverUrl === undefined
          ? this.status.serverUrl
          : partial.serverUrl,
    }

    for (const listener of this.listeners) {
      listener(this.getStatus())
    }
  }
}
