import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { afterEach, describe, expect, it } from "vitest"

import { runMigrations } from "./migrator.js"

const temporaryDirectories: string[] = []

function createDatabase(): DatabaseSync {
  const directory = mkdtempSync(join(tmpdir(), "ultra-migrations-"))
  temporaryDirectories.push(directory)

  return new DatabaseSync(join(directory, "migrations.db"))
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("migration runner", () => {
  it("records applied migrations", () => {
    const database = createDatabase()
    const result = runMigrations(database, {
      now: () => "2026-03-14T00:00:00.000Z",
    })

    const rows = database
      .prepare<[string], { id: string; applied_at: string }>(
        "SELECT id, applied_at FROM schema_migrations ORDER BY id ASC",
      )
      .all()

    expect(result.appliedMigrationIds).toEqual([
      "0001_initial_foundations",
      "0002_add_layout_pane_tabs",
      "0003_chat_persistence",
    ])
    expect(rows).toEqual([
      {
        id: "0001_initial_foundations",
        applied_at: "2026-03-14T00:00:00.000Z",
      },
      {
        id: "0002_add_layout_pane_tabs",
        applied_at: "2026-03-14T00:00:00.000Z",
      },
      {
        id: "0003_chat_persistence",
        applied_at: "2026-03-14T00:00:00.000Z",
      },
    ])

    database.close()
  })

  it("rolls back failed migrations without marking them applied", () => {
    const database = createDatabase()

    expect(() =>
      runMigrations(database, {
        migrations: [
          {
            id: "0001_ok",
            sql: "CREATE TABLE test_table (id TEXT PRIMARY KEY);",
          },
          {
            id: "0002_broken",
            sql: "INSERT INTO missing_table VALUES ('oops');",
          },
        ],
      }),
    ).toThrow()

    const migrationRows = database
      .prepare<[string], { id: string }>(
        "SELECT id FROM schema_migrations ORDER BY id ASC",
      )
      .all()
    const createdTables = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_table'",
      )
      .all()

    expect(migrationRows).toEqual([])
    expect(createdTables).toEqual([])

    database.close()
  })
})
