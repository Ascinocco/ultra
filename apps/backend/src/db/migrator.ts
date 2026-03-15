import type { DatabaseSync } from "node:sqlite"

import { DATABASE_MIGRATIONS, type DatabaseMigration } from "./migrations.js"

export type MigrationRunResult = {
  appliedMigrationIds: string[]
  latestMigrationId: string | null
  totalMigrationCount: number
}

function ensureSchemaMigrationsTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
}

function listAppliedMigrationIds(database: DatabaseSync): Set<string> {
  const rows = database
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all() as Array<{
    id: string
  }>

  return new Set(rows.map((row) => row.id))
}

export function runMigrations(
  database: DatabaseSync,
  options: {
    now?: () => string
    migrations?: DatabaseMigration[]
  } = {},
): MigrationRunResult {
  const now = options.now ?? (() => new Date().toISOString())
  const migrations = options.migrations ?? DATABASE_MIGRATIONS

  ensureSchemaMigrationsTable(database)

  const appliedMigrationIds = listAppliedMigrationIds(database)
  const pendingMigrations = migrations.filter(
    (migration) => !appliedMigrationIds.has(migration.id),
  )
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  )

  if (pendingMigrations.length > 0) {
    database.exec("BEGIN")

    try {
      for (const migration of pendingMigrations) {
        database.exec(migration.sql)
        recordMigration.run(migration.id, now())
      }

      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }

  return {
    appliedMigrationIds: pendingMigrations.map((migration) => migration.id),
    latestMigrationId:
      migrations.length > 0
        ? (migrations[migrations.length - 1]?.id ?? null)
        : null,
    totalMigrationCount: migrations.length,
  }
}
