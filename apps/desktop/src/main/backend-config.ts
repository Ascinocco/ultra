import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import type { App } from "electron"

export type BackendLaunchConfig = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  socketPath: string
  databasePath: string
  startupGraceMs: number
  shutdownTimeoutMs: number
  restartDelayMs: number
  maxRestartAttempts: number
  isDev: boolean
}

function resolveWorkspaceRoot(): string {
  return resolve(import.meta.dirname, "../../../../")
}

function resolveTsxBinary(backendRoot: string): string {
  return join(
    backendRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  )
}

export function createBackendLaunchConfig(app: App): BackendLaunchConfig {
  const workspaceRoot = resolveWorkspaceRoot()
  const backendRoot = join(workspaceRoot, "apps/backend")
  const socketDirectory = join(app.getPath("userData"), "run")
  const dataDirectory = join(app.getPath("userData"), "data")

  mkdirSync(socketDirectory, { recursive: true })
  mkdirSync(dataDirectory, { recursive: true })

  const socketPath = join(socketDirectory, "ultra-backend.sock")
  const databasePath = join(dataDirectory, "ultra.db")
  const isDev = !app.isPackaged
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: isDev ? "development" : "production",
    ULTRA_BACKEND_SESSION_MODE: "desktop",
    ULTRA_PROJECT_ROOT: workspaceRoot,
    ULTRA_SOCKET_PATH: socketPath,
    ULTRA_DB_PATH: databasePath,
  }

  if (isDev) {
    return {
      command: resolveTsxBinary(backendRoot),
      args: ["src/index.ts"],
      cwd: backendRoot,
      env,
      socketPath,
      databasePath,
      startupGraceMs: 400,
      shutdownTimeoutMs: 3_000,
      restartDelayMs: 700,
      maxRestartAttempts: 2,
      isDev,
    }
  }

  return {
    command: "node",
    args: ["dist/index.js"],
    cwd: backendRoot,
    env,
    socketPath,
    databasePath,
    startupGraceMs: 400,
    shutdownTimeoutMs: 3_000,
    restartDelayMs: 700,
    maxRestartAttempts: 2,
    isDev,
  }
}
