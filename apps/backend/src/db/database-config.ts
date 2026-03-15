import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

export type DatabaseConfig = {
  path: string
}

export function createDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const configuredPath = env.ULTRA_DB_PATH?.trim()

  if (!configuredPath) {
    throw new Error("ULTRA_DB_PATH is required to start the backend")
  }

  return {
    path: resolve(configuredPath),
  }
}

export function ensureDatabaseDirectory(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true })
}
