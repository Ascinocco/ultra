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
  const isDev = !app.isPackaged
  const socketDirectory = join(app.getPath("userData"), "run")
  const dataDirectory = join(app.getPath("userData"), "data")

  mkdirSync(socketDirectory, { recursive: true })
  mkdirSync(dataDirectory, { recursive: true })

  const socketPath = join(socketDirectory, "ultra-backend.sock")
  const databasePath = join(dataDirectory, "ultra.db")

  if (isDev) {
    const workspaceRoot = resolveWorkspaceRoot()
    const backendRoot = join(workspaceRoot, "apps/backend")
    return {
      command: resolveTsxBinary(backendRoot),
      args: ["src/index.ts"],
      cwd: backendRoot,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ULTRA_BACKEND_SESSION_MODE: "desktop",
        ULTRA_PROJECT_ROOT: workspaceRoot,
        ULTRA_SOCKET_PATH: socketPath,
        ULTRA_DB_PATH: databasePath,
      },
      socketPath,
      databasePath,
      startupGraceMs: 400,
      shutdownTimeoutMs: 3_000,
      restartDelayMs: 700,
      maxRestartAttempts: 2,
      isDev,
    }
  }

  // Production: backend is in extraResources
  const resourcesPath = process.resourcesPath
  const backendRoot = join(resourcesPath, "backend")
  const sharedRoot = join(resourcesPath, "shared")

  return {
    command: process.execPath,
    args: ["--no-warnings", "dist/index.js"],
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ELECTRON_RUN_AS_NODE: "1",
      ULTRA_BACKEND_SESSION_MODE: "desktop",
      ULTRA_SOCKET_PATH: socketPath,
      ULTRA_DB_PATH: databasePath,
      // Tell Node where to find the shared package
      NODE_PATH: join(sharedRoot, "dist"),
    },
    socketPath,
    databasePath,
    startupGraceMs: 400,
    shutdownTimeoutMs: 3_000,
    restartDelayMs: 700,
    maxRestartAttempts: 2,
    isDev,
  }
}
