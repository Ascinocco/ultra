import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "./database.js"

const temporaryDirectories: string[] = []

function createTestPaths(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ultra-db-"))
  temporaryDirectories.push(directory)

  return {
    directory,
    databasePath: join(directory, "data", "ultra.db"),
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { force: true, recursive: true })
    }
  }
})

describe("database bootstrap", () => {
  it("creates the database, applies pragmas, and runs migrations", () => {
    const { databasePath } = createTestPaths()
    const runtime = bootstrapDatabase({
      ULTRA_DB_PATH: databasePath,
    })

    expect(runtime.databasePath).toBe(databasePath)
    expect(runtime.database.prepare("PRAGMA foreign_keys").get()).toEqual(
      expect.objectContaining({ foreign_keys: 1 }),
    )
    expect(runtime.database.prepare("PRAGMA journal_mode").get()).toEqual(
      expect.objectContaining({ journal_mode: "wal" }),
    )
    expect(runtime.migrationResult.appliedMigrationIds).toContain(
      "0001_initial_foundations",
    )
    expect(runtime.migrationResult.appliedMigrationIds).toContain(
      "0003_chat_persistence",
    )
    expect(runtime.migrationResult.appliedMigrationIds).toContain(
      "0004_runtime_registry",
    )
    expect(runtime.migrationResult.appliedMigrationIds).toContain(
      "0006_sandbox_context_and_runtime_sync",
    )
    expect(runtime.migrationResult.appliedMigrationIds).toContain(
      "0007_thread_events_foundation",
    )

    const tables = runtime.database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .all("projects")

    expect(tables).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("chats"),
    ).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("project_runtimes"),
    ).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("runtime_components"),
    ).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("runtime_health_checks"),
    ).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("sandbox_contexts"),
    ).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("project_runtime_profiles"),
    ).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("sandbox_runtime_syncs"),
    ).toHaveLength(1)
    expect(
      runtime.database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all("thread_events"),
    ).toHaveLength(1)

    runtime.close()
  })

  it("reuses an existing database without reapplying migrations", () => {
    const { databasePath } = createTestPaths()
    const firstRuntime = bootstrapDatabase({
      ULTRA_DB_PATH: databasePath,
    })

    firstRuntime.close()

    const secondRuntime = bootstrapDatabase({
      ULTRA_DB_PATH: databasePath,
    })

    expect(secondRuntime.migrationResult.appliedMigrationIds).toEqual([])
    expect(secondRuntime.migrationResult.latestMigrationId).toBe(
      "0007_thread_events_foundation",
    )

    secondRuntime.close()
  })

  it("fails clearly when ULTRA_DB_PATH is missing", () => {
    expect(() => bootstrapDatabase({})).toThrow(/ULTRA_DB_PATH is required/)
  })
})
