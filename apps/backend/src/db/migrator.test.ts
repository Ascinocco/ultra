import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { afterEach, describe, expect, it } from "vitest"

import { runMigrations } from "./migrator.js"
import { DATABASE_MIGRATIONS } from "./migrations.js"

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
      "0004_runtime_registry",
      "0005_thread_core",
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
      {
        id: "0004_runtime_registry",
        applied_at: "2026-03-14T00:00:00.000Z",
      },
      {
        id: "0005_thread_core",
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

  it("applies 0005_thread_core on a fresh database", () => {
    const database = createDatabase()
    const result = runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
    })

    expect(result.appliedMigrationIds).toContain("0005_thread_core")
    expect(result.totalMigrationCount).toBe(5)

    // Verify threads table exists with correct columns
    const threadColumns = database
      .prepare("PRAGMA table_info(threads)")
      .all() as Array<{ name: string }>
    const columnNames = threadColumns.map((c) => c.name)

    expect(columnNames).toContain("id")
    expect(columnNames).toContain("project_id")
    expect(columnNames).toContain("source_chat_id")
    expect(columnNames).toContain("execution_state")
    expect(columnNames).toContain("worktree_id")
    expect(columnNames).toContain("last_event_sequence")

    // Verify thread_messages table exists
    const msgColumns = database
      .prepare("PRAGMA table_info(thread_messages)")
      .all() as Array<{ name: string }>
    expect(msgColumns.map((c) => c.name)).toContain("id")
    expect(msgColumns.map((c) => c.name)).toContain("thread_id")
    expect(msgColumns.map((c) => c.name)).toContain("content_json")

    // Verify thread_specs table exists
    const specColumns = database
      .prepare("PRAGMA table_info(thread_specs)")
      .all() as Array<{ name: string }>
    expect(specColumns.map((c) => c.name)).toContain("thread_id")
    expect(specColumns.map((c) => c.name)).toContain("spec_path")

    // Verify thread_ticket_refs table exists
    const ticketColumns = database
      .prepare("PRAGMA table_info(thread_ticket_refs)")
      .all() as Array<{ name: string }>
    expect(ticketColumns.map((c) => c.name)).toContain("thread_id")
    expect(ticketColumns.map((c) => c.name)).toContain("provider")

    database.close()
  })
})
