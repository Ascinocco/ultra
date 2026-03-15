import { DatabaseSync } from "node:sqlite"

import {
  createDatabaseConfig,
  ensureDatabaseDirectory,
} from "./database-config.js"
import { type MigrationRunResult, runMigrations } from "./migrator.js"

export type DatabaseRuntime = {
  database: DatabaseSync
  databasePath: string
  migrationResult: MigrationRunResult
  close: () => void
}

function applyPragmas(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL;")
  database.exec("PRAGMA foreign_keys = ON;")
  database.exec("PRAGMA synchronous = NORMAL;")
  database.exec("PRAGMA temp_store = MEMORY;")
}

export function bootstrapDatabase(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseRuntime {
  const config = createDatabaseConfig(env)

  ensureDatabaseDirectory(config.path)

  const database = new DatabaseSync(config.path)

  try {
    applyPragmas(database)

    const migrationResult = runMigrations(database)

    return {
      database,
      databasePath: config.path,
      migrationResult,
      close: () => {
        if (database.isOpen) {
          database.close()
        }
      },
    }
  } catch (error) {
    if (database.isOpen) {
      database.close()
    }

    throw error
  }
}
