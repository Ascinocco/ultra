import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { afterEach, describe, expect, it } from "vitest"
import { DATABASE_MIGRATIONS } from "./migrations.js"
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
      "0004_runtime_registry",
      "0005_thread_core",
      "0006_thread_events_foundation",
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
      {
        id: "0006_thread_events_foundation",
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

  it("applies 0006_thread_events_foundation on a fresh database", () => {
    const database = createDatabase()
    const result = runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
    })

    expect(result.appliedMigrationIds).toContain("0005_thread_core")
    expect(result.appliedMigrationIds).toContain(
      "0006_thread_events_foundation",
    )
    expect(result.totalMigrationCount).toBe(6)

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

    const eventColumns = database
      .prepare("PRAGMA table_info(thread_events)")
      .all() as Array<{ name: string }>
    expect(eventColumns.map((c) => c.name)).toContain("event_id")
    expect(eventColumns.map((c) => c.name)).toContain("thread_id")
    expect(eventColumns.map((c) => c.name)).toContain("sequence_number")

    database.close()
  })
})

describe("thread core FK constraints", () => {
  function createMigratedDatabase(): DatabaseSync {
    const database = createDatabase()
    database.exec("PRAGMA foreign_keys = ON")
    runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
    })
    return database
  }

  function insertProject(database: DatabaseSync, id = "proj_1"): void {
    database
      .prepare(
        "INSERT INTO projects (id, project_key, name, root_path, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        "test-project",
        "Test",
        "/tmp/test",
        "2026-03-15T00:00:00Z",
        "2026-03-15T00:00:00Z",
        "2026-03-15T00:00:00Z",
      )
  }

  function insertChat(
    database: DatabaseSync,
    id = "chat_1",
    projectId = "proj_1",
  ): void {
    database
      .prepare(
        "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        projectId,
        "Test Chat",
        "active",
        "anthropic",
        "claude-4",
        "standard",
        "supervised",
        "2026-03-15T00:00:00Z",
        "2026-03-15T00:00:00Z",
      )
  }

  function insertThread(
    database: DatabaseSync,
    id = "thread_1",
    projectId = "proj_1",
    chatId = "chat_1",
  ): void {
    database
      .prepare(
        "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        projectId,
        chatId,
        "Test Thread",
        "pending",
        "none",
        "none",
        "2026-03-15T00:00:00Z",
        "2026-03-15T00:00:00Z",
      )
  }

  it("rejects a thread with nonexistent project_id", () => {
    const database = createMigratedDatabase()

    expect(() =>
      database
        .prepare(
          "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "thread_1",
          "nonexistent",
          "chat_1",
          "T",
          "pending",
          "none",
          "none",
          "2026-03-15T00:00:00Z",
          "2026-03-15T00:00:00Z",
        ),
    ).toThrow()

    database.close()
  })

  it("rejects a thread with nonexistent source_chat_id", () => {
    const database = createMigratedDatabase()
    insertProject(database)

    expect(() =>
      database
        .prepare(
          "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "thread_1",
          "proj_1",
          "nonexistent",
          "T",
          "pending",
          "none",
          "none",
          "2026-03-15T00:00:00Z",
          "2026-03-15T00:00:00Z",
        ),
    ).toThrow()

    database.close()
  })

  it("cascades project deletion to threads", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database.prepare("DELETE FROM projects WHERE id = ?").run("proj_1")

    const threads = database.prepare("SELECT id FROM threads").all() as Array<{
      id: string
    }>
    expect(threads).toEqual([])

    database.close()
  })

  it("restricts chat deletion when threads reference it", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    expect(() =>
      database.prepare("DELETE FROM chats WHERE id = ?").run("chat_1"),
    ).toThrow()

    database.close()
  })

  it("chat_thread_refs rejects nonexistent thread_id", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)

    expect(() =>
      database
        .prepare(
          "INSERT INTO chat_thread_refs (chat_id, thread_id, reference_type, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("chat_1", "nonexistent", "spawned", "2026-03-15T00:00:00Z"),
    ).toThrow()

    database.close()
  })

  it("chat_thread_refs accepts valid references", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database
      .prepare(
        "INSERT INTO chat_thread_refs (chat_id, thread_id, reference_type, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("chat_1", "thread_1", "spawned", "2026-03-15T00:00:00Z")

    const refs = database
      .prepare("SELECT * FROM chat_thread_refs")
      .all() as Array<{ chat_id: string; thread_id: string }>
    expect(refs).toHaveLength(1)
    expect(refs[0].chat_id).toBe("chat_1")
    expect(refs[0].thread_id).toBe("thread_1")

    database.close()
  })

  it("cascades thread deletion to thread_messages", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database
      .prepare(
        "INSERT INTO thread_messages (id, thread_id, role, message_type, content_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "msg_1",
        "thread_1",
        "assistant",
        "text",
        '{"text":"hello"}',
        "2026-03-15T00:00:00Z",
      )

    database.prepare("DELETE FROM projects WHERE id = ?").run("proj_1")

    const messages = database
      .prepare("SELECT id FROM thread_messages")
      .all() as Array<{ id: string }>
    expect(messages).toEqual([])

    database.close()
  })

  it("incremental apply on DB with 0001-0004 applies only 0005", () => {
    const database = createDatabase()

    // Apply only 0001-0004 first
    const firstResult = runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
      migrations: DATABASE_MIGRATIONS.slice(0, 4),
    })
    expect(firstResult.appliedMigrationIds).toHaveLength(4)

    // Now run full migrations — only 0005 should apply
    const secondResult = runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
    })

    expect(secondResult.appliedMigrationIds).toEqual([
      "0005_thread_core",
      "0006_thread_events_foundation",
    ])
    expect(secondResult.totalMigrationCount).toBe(6)

    database.close()
  })

  it("preserves valid chat_thread_refs data through table recreation", () => {
    const database = createDatabase()
    database.exec("PRAGMA foreign_keys = ON")

    // Apply only 0001-0004 first
    runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
      migrations: DATABASE_MIGRATIONS.slice(0, 4),
    })

    // Insert prerequisite data
    insertProject(database)
    insertChat(database)

    // Insert a chat_thread_refs row with a thread_id that won't exist yet.
    // The old table from 0003 has no thread FK so this succeeds.
    database
      .prepare(
        "INSERT INTO chat_thread_refs (chat_id, thread_id, reference_type, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("chat_1", "orphaned_thread", "spawned", "2026-03-15T00:00:00Z")

    // Apply 0005 — the orphaned row should be purged during recreation
    // since its thread_id doesn't exist in the (empty) threads table.
    runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
    })

    // Verify orphaned row was purged
    const refs = database
      .prepare("SELECT * FROM chat_thread_refs")
      .all() as Array<{ chat_id: string; thread_id: string }>
    expect(refs).toEqual([])

    // Verify the new table has the FK constraint by testing it rejects bad data
    expect(() =>
      database
        .prepare(
          "INSERT INTO chat_thread_refs (chat_id, thread_id, reference_type, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("chat_1", "nonexistent", "spawned", "2026-03-15T00:00:00Z"),
    ).toThrow()

    database.close()
  })

  it("re-running migrations after full apply is a no-op", () => {
    const database = createDatabase()
    runMigrations(database, { now: () => "2026-03-15T00:00:00.000Z" })

    const result = runMigrations(database, {
      now: () => "2026-03-15T00:00:00.000Z",
    })

    expect(result.appliedMigrationIds).toEqual([])
    expect(result.totalMigrationCount).toBe(6)

    database.close()
  })
})
