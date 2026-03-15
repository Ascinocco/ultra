# ULR-10: Thread Core Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add migration 0005 creating thread core tables (`threads`, `chat_thread_refs` FK backfill, `thread_specs`, `thread_ticket_refs`, `thread_messages`) to the SQLite schema.

**Architecture:** Single migration appended to the `DATABASE_MIGRATIONS` array in `apps/backend/src/db/migrations.ts`. The existing migrator (`migrator.ts`) handles transaction wrapping, rollback, and tracking via `schema_migrations`. Tests follow the established pattern in `migrator.test.ts` using in-memory temp databases.

**Tech Stack:** Node.js built-in `node:sqlite` (DatabaseSync), Vitest, SQLite DDL

**Spec:** `docs/superpowers/specs/2026-03-15-ulr-10-chat-thread-migrations-design.md`

**Important context:**
- In production, `bootstrapDatabase()` in `apps/backend/src/db/database.ts` calls `PRAGMA foreign_keys = ON` **before** `runMigrations()`. All migration DDL executes with FK enforcement active.
- The migrator wraps all pending migrations in a single `BEGIN`/`COMMIT` transaction.
- `PRAGMA foreign_keys` cannot be changed inside a transaction.
- Therefore the `chat_thread_refs` table recreation must purge any orphaned rows (thread_ids not in `threads`) before INSERT, since the new table's FK will be enforced.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/backend/src/db/migrations.ts` | Modify | Append `0005_thread_core` migration DDL |
| `apps/backend/src/db/migrator.test.ts` | Modify | Add tests for 0005: fresh apply, incremental apply, FK enforcement, cascade/restrict, data preservation |

Two files. No new files created.

---

## Chunk 1: Migration and Tests

### Task 1: Add migration DDL and update existing recording test

**Files:**
- Modify: `apps/backend/src/db/migrations.ts:210` (append after last migration)
- Modify: `apps/backend/src/db/migrator.test.ts:1-68` (add import, update existing test, add new test)

- [ ] **Step 1: Write the failing test for 0005 migration existence**

First, add the `DATABASE_MIGRATIONS` import to `apps/backend/src/db/migrator.test.ts` at line 8, after the existing `runMigrations` import:

```typescript
import { DATABASE_MIGRATIONS } from "./migrations.js"
```

Then add to `apps/backend/src/db/migrator.test.ts` inside the existing `describe("migration runner")` block, after the last test (line 103):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/db/migrator.test.ts -t "applies 0005"`
Expected: FAIL — `0005_thread_core` not found in `appliedMigrationIds`, `totalMigrationCount` is 4 not 5.

- [ ] **Step 3: Write the migration DDL**

Add to `apps/backend/src/db/migrations.ts`, appending to the `DATABASE_MIGRATIONS` array after the `0004_runtime_registry` entry:

```typescript
{
  id: "0005_thread_core",
  sql: `
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_chat_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      execution_state TEXT NOT NULL,
      review_state TEXT NOT NULL,
      publish_state TEXT NOT NULL,
      backend_health TEXT NOT NULL DEFAULT 'healthy',
      coordinator_health TEXT NOT NULL DEFAULT 'healthy',
      watch_health TEXT NOT NULL DEFAULT 'healthy',
      ov_project_id TEXT,
      ov_coordinator_id TEXT,
      ov_thread_key TEXT,
      worktree_id TEXT,
      branch_name TEXT,
      base_branch TEXT,
      latest_commit_sha TEXT,
      pr_provider TEXT,
      pr_number TEXT,
      pr_url TEXT,
      last_event_sequence INTEGER NOT NULL DEFAULT 0,
      restart_count INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_by_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT,
      approved_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (source_chat_id) REFERENCES chats(id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_threads_project_activity
      ON threads(project_id, last_activity_at DESC);

    CREATE INDEX IF NOT EXISTS idx_threads_chat_activity
      ON threads(source_chat_id, last_activity_at DESC);

    CREATE INDEX IF NOT EXISTS idx_threads_project_execution_state
      ON threads(project_id, execution_state);

    -- Recreate chat_thread_refs with FK to threads.
    -- Original from 0003 had no thread FK since threads table didn't exist.
    -- Must purge orphaned rows before recreation since FKs are enforced in production.
    ALTER TABLE chat_thread_refs RENAME TO chat_thread_refs_old;

    CREATE TABLE IF NOT EXISTS chat_thread_refs (
      chat_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, thread_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    INSERT INTO chat_thread_refs
      SELECT * FROM chat_thread_refs_old
      WHERE thread_id IN (SELECT id FROM threads);

    DROP TABLE chat_thread_refs_old;

    CREATE TABLE IF NOT EXISTS thread_specs (
      thread_id TEXT NOT NULL,
      spec_path TEXT NOT NULL,
      spec_slug TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, spec_path),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS thread_ticket_refs (
      thread_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      display_label TEXT NOT NULL,
      url TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, provider, external_id),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS thread_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      message_type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      artifact_refs_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_created
      ON thread_messages(thread_id, created_at);
  `,
},
```

**Also update the existing "records applied migrations" test** (line 30 in `migrator.test.ts`) in the same step to expect 5 migrations. Change the `expect(result.appliedMigrationIds)` assertion:

```typescript
expect(result.appliedMigrationIds).toEqual([
  "0001_initial_foundations",
  "0002_add_layout_pane_tabs",
  "0003_chat_persistence",
  "0004_runtime_registry",
  "0005_thread_core",
])
```

And add the corresponding row to `expect(rows)`:

```typescript
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
```

- [ ] **Step 4: Run all migrator tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/db/migrator.test.ts`
Expected: PASS — both "records applied migrations" and "applies 0005_thread_core" pass

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/migrations.ts apps/backend/src/db/migrator.test.ts
git commit -m "feat: add 0005_thread_core migration with existence and recording tests"
```

---

### Task 2: Add FK constraint enforcement tests

**Files:**
- Modify: `apps/backend/src/db/migrator.test.ts`

- [ ] **Step 1: Write FK constraint tests**

Add a new `describe("thread core FK constraints")` block after the existing `describe("migration runner")` block in `apps/backend/src/db/migrator.test.ts`:

```typescript
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
      .run(id, "test-project", "Test", "/tmp/test", "2026-03-15T00:00:00Z", "2026-03-15T00:00:00Z", "2026-03-15T00:00:00Z")
  }

  function insertChat(database: DatabaseSync, id = "chat_1", projectId = "proj_1"): void {
    database
      .prepare(
        "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, projectId, "Test Chat", "active", "anthropic", "claude-4", "standard", "supervised", "2026-03-15T00:00:00Z", "2026-03-15T00:00:00Z")
  }

  function insertThread(database: DatabaseSync, id = "thread_1", projectId = "proj_1", chatId = "chat_1"): void {
    database
      .prepare(
        "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, projectId, chatId, "Test Thread", "pending", "none", "none", "2026-03-15T00:00:00Z", "2026-03-15T00:00:00Z")
  }

  it("rejects a thread with nonexistent project_id", () => {
    const database = createMigratedDatabase()

    expect(() =>
      database
        .prepare(
          "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("thread_1", "nonexistent", "chat_1", "T", "pending", "none", "none", "2026-03-15T00:00:00Z", "2026-03-15T00:00:00Z"),
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
        .run("thread_1", "proj_1", "nonexistent", "T", "pending", "none", "none", "2026-03-15T00:00:00Z", "2026-03-15T00:00:00Z"),
    ).toThrow()

    database.close()
  })

  it("cascades project deletion to threads", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database.prepare("DELETE FROM projects WHERE id = ?").run("proj_1")

    const threads = database
      .prepare("SELECT id FROM threads")
      .all() as Array<{ id: string }>
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
      .run("msg_1", "thread_1", "assistant", "text", '{"text":"hello"}', "2026-03-15T00:00:00Z")

    database.prepare("DELETE FROM projects WHERE id = ?").run("proj_1")

    const messages = database
      .prepare("SELECT id FROM thread_messages")
      .all() as Array<{ id: string }>
    expect(messages).toEqual([])

    database.close()
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/db/migrator.test.ts`
Expected: PASS — all tests green

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/migrator.test.ts
git commit -m "test: add thread core FK constraint enforcement tests"
```

---

### Task 3: Add incremental migration and data preservation tests

**Files:**
- Modify: `apps/backend/src/db/migrator.test.ts`

- [ ] **Step 1: Write the incremental migration test and data preservation test**

Add inside the `describe("thread core FK constraints")` block (which has access to the helper functions):

```typescript
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

  expect(secondResult.appliedMigrationIds).toEqual(["0005_thread_core"])
  expect(secondResult.totalMigrationCount).toBe(5)

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
  expect(result.totalMigrationCount).toBe(5)

  database.close()
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/db/migrator.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/migrator.test.ts
git commit -m "test: add incremental migration and data preservation tests"
```

---

### Task 4: Run full test suite and verify no regressions

**Files:** None (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: All tests pass (existing project-service, database, index tests + new migrator tests)

- [ ] **Step 2: Run the full monorepo test suite**

Run: `pnpm test` (from repo root)
Expected: All packages pass

- [ ] **Step 3: Commit (if any formatting/lint fixes needed)**

Only if Biome or similar required changes:
```bash
git add -A
git commit -m "chore: fix lint/formatting from migration changes"
```
