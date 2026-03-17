# ULR-73: Thread Events, Agents, and Approvals Migrations

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add migration 0009 with four new tables (thread_event_logs, thread_agents, thread_file_changes, approvals), corresponding Zod contracts, and comprehensive migration tests.

**Architecture:** Single SQLite migration creating all four tables with FK constraints and indexes. Zod snapshot schemas in shared contracts package. Thread-related schemas go in existing `threads.ts`; approvals get a new `approvals.ts` file.

**Tech Stack:** SQLite, Zod, Vitest, node:sqlite DatabaseSync

**Spec:** `docs/superpowers/specs/2026-03-17-ulr-73-thread-events-agents-approvals-migrations-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/backend/src/db/migrations.ts` | Modify | Add migration `0009_thread_agents_events_and_approvals` |
| `apps/backend/src/db/migrator.test.ts` | Modify | Add tests for migration 0009 tables, FKs, indexes, cascades |
| `packages/shared/src/contracts/threads.ts` | Modify | Add threadEventLogSnapshot, threadAgentSnapshot, threadFileChangeSnapshot schemas |
| `packages/shared/src/contracts/approvals.ts` | Create | New file — approvalSnapshot schema and enums |
| `packages/shared/src/index.ts` | Modify | Re-export new schemas and types |
| `packages/shared/src/index.test.ts` | Modify | Add parse tests for new schemas |

---

## Task 1: Add migration 0009

**Files:**
- Modify: `apps/backend/src/db/migrations.ts` (append to `DATABASE_MIGRATIONS` array after line 495)

- [ ] **Step 1: Add migration SQL**

Add the following entry to the `DATABASE_MIGRATIONS` array in `apps/backend/src/db/migrations.ts`, after the `0008_artifacts_and_sharing` entry:

```typescript
  {
    id: "0009_thread_agents_events_and_approvals",
    sql: `
      CREATE TABLE IF NOT EXISTS thread_event_logs (
        log_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES thread_events(event_id) ON DELETE SET NULL,
        agent_id TEXT,
        agent_type TEXT,
        stream TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_thread_event_logs_thread_created
        ON thread_event_logs(thread_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_thread_event_logs_thread_agent
        ON thread_event_logs(thread_id, agent_id, chunk_index);

      CREATE TABLE IF NOT EXISTS thread_agents (
        agent_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        parent_agent_id TEXT REFERENCES thread_agents(agent_id) ON DELETE SET NULL,
        agent_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        work_item_ref TEXT,
        started_at TEXT,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_thread_agents_thread_status
        ON thread_agents(thread_id, status);

      CREATE TABLE IF NOT EXISTS thread_file_changes (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        old_path TEXT,
        additions INTEGER,
        deletions INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_file_changes_thread
        ON thread_file_changes(thread_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        approval_type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        payload_json TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_thread_status
        ON approvals(thread_id, status);

      CREATE INDEX IF NOT EXISTS idx_approvals_project_status
        ON approvals(project_id, status);
    `,
  },
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/backend exec vitest run src/db/migrator.test.ts`

Expected: Tests fail because existing assertions expect 8 migrations but now there are 9. This is expected — we fix the tests in Task 3.

- [ ] **Step 3: Commit migration**

```bash
git add apps/backend/src/db/migrations.ts
git commit -m "feat(db): add migration 0009 for thread agents, event logs, file changes, and approvals"
```

---

## Task 2: Add Zod contracts

**Files:**
- Modify: `packages/shared/src/contracts/threads.ts` (add after `threadEventSnapshotSchema` block, around line 110)
- Create: `packages/shared/src/contracts/approvals.ts`
- Modify: `packages/shared/src/index.ts` (add re-exports)

- [ ] **Step 1: Add thread event log, agent, and file change schemas to threads.ts**

Add the following after the `threadEventSnapshotSchema` block (after line 110) in `packages/shared/src/contracts/threads.ts`:

```typescript
// ── Thread Event Logs ────────────────────────────────────────────────

export const threadEventLogSnapshotSchema = z.object({
  logId: z.string(),
  projectId: opaqueIdSchema,
  threadId: opaqueIdSchema,
  eventId: z.string().nullable(),
  agentId: z.string().nullable(),
  agentType: z.string().nullable(),
  stream: z.string(),
  chunkIndex: z.number().int(),
  chunkText: z.string(),
  createdAt: isoUtcTimestampSchema,
})

// ── Thread Agents ────────────────────────────────────────────────────

export const threadAgentStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
])

export const threadAgentSnapshotSchema = z.object({
  agentId: z.string(),
  threadId: opaqueIdSchema,
  parentAgentId: z.string().nullable(),
  agentType: z.string(),
  displayName: z.string(),
  status: threadAgentStatusSchema,
  summary: z.string().nullable(),
  workItemRef: z.string().nullable(),
  startedAt: isoUtcTimestampSchema.nullable(),
  updatedAt: isoUtcTimestampSchema,
  finishedAt: isoUtcTimestampSchema.nullable(),
})

// ── Thread File Changes ──────────────────────────────────────────────

export const fileChangeTypeSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
])

export const threadFileChangeSnapshotSchema = z.object({
  threadId: opaqueIdSchema,
  path: z.string(),
  changeType: fileChangeTypeSchema,
  oldPath: z.string().nullable(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  updatedAt: isoUtcTimestampSchema,
})
```

Add the following types in the type exports block (after line 367):

```typescript
export type ThreadEventLogSnapshot = z.infer<typeof threadEventLogSnapshotSchema>
export type ThreadAgentStatus = z.infer<typeof threadAgentStatusSchema>
export type ThreadAgentSnapshot = z.infer<typeof threadAgentSnapshotSchema>
export type FileChangeType = z.infer<typeof fileChangeTypeSchema>
export type ThreadFileChangeSnapshot = z.infer<
  typeof threadFileChangeSnapshotSchema
>
```

Add the following parse functions in the parse functions block (after line 464):

```typescript
export function parseThreadEventLogSnapshot(
  input: unknown,
): ThreadEventLogSnapshot {
  return threadEventLogSnapshotSchema.parse(input)
}

export function parseThreadAgentSnapshot(
  input: unknown,
): ThreadAgentSnapshot {
  return threadAgentSnapshotSchema.parse(input)
}

export function parseThreadFileChangeSnapshot(
  input: unknown,
): ThreadFileChangeSnapshot {
  return threadFileChangeSnapshotSchema.parse(input)
}
```

- [ ] **Step 2: Create approvals.ts**

Create `packages/shared/src/contracts/approvals.ts`:

```typescript
import { z } from "zod"
import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import { projectIdSchema } from "./projects.js"
import { threadIdSchema } from "./threads.js"

export const approvalTypeSchema = z.enum([
  "plan",
  "spec",
  "review",
  "publish",
])

export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
])

export const approvalSnapshotSchema = z.object({
  approvalId: z.string(),
  projectId: projectIdSchema,
  threadId: threadIdSchema,
  approvalType: approvalTypeSchema,
  status: approvalStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  requestedAt: isoUtcTimestampSchema,
  resolvedAt: isoUtcTimestampSchema.nullable(),
  resolvedBy: z.string().nullable(),
})

export type ApprovalType = z.infer<typeof approvalTypeSchema>
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>
export type ApprovalSnapshot = z.infer<typeof approvalSnapshotSchema>

export function parseApprovalSnapshot(input: unknown): ApprovalSnapshot {
  return approvalSnapshotSchema.parse(input)
}
```

- [ ] **Step 3: Add re-exports to index.ts**

Add the following to `packages/shared/src/index.ts`:

After the threads type exports block, add:

```typescript
export type {
  ApprovalSnapshot,
  ApprovalStatus,
  ApprovalType,
} from "./contracts/approvals.js"
export {
  approvalSnapshotSchema,
  approvalStatusSchema,
  approvalTypeSchema,
  parseApprovalSnapshot,
} from "./contracts/approvals.js"
```

In the existing threads type export block, add:

```typescript
  FileChangeType,
  ThreadAgentSnapshot,
  ThreadAgentStatus,
  ThreadEventLogSnapshot,
  ThreadFileChangeSnapshot,
```

In the existing threads value export block, add:

```typescript
  fileChangeTypeSchema,
  parseThreadAgentSnapshot,
  parseThreadEventLogSnapshot,
  parseThreadFileChangeSnapshot,
  threadAgentSnapshotSchema,
  threadAgentStatusSchema,
  threadEventLogSnapshotSchema,
  threadFileChangeSnapshotSchema,
```

- [ ] **Step 4: Verify shared package builds**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/shared exec tsc --noEmit`

Expected: PASS — no type errors.

- [ ] **Step 5: Commit contracts**

```bash
git add packages/shared/src/contracts/threads.ts packages/shared/src/contracts/approvals.ts packages/shared/src/index.ts
git commit -m "feat(shared): add Zod schemas for thread event logs, agents, file changes, and approvals"
```

---

## Task 3: Add migration tests

**Files:**
- Modify: `apps/backend/src/db/migrator.test.ts`

- [ ] **Step 1: Update "records applied migrations" test**

In the `"records applied migrations"` test, update the `appliedMigrationIds` expectation array to include `"0009_thread_agents_events_and_approvals"` and add the corresponding `schema_migrations` row expectation.

- [ ] **Step 2: Update "re-running migrations after full apply" test**

Update `totalMigrationCount` from `8` to `9`.

- [ ] **Step 3: Update "incremental apply" test**

In the `"incremental apply on DB with 0001-0007 applies only 0008"` test:
- Update the test description: `"incremental apply on DB with 0001-0007 applies 0008 and 0009"`
- Update the `appliedMigrationIds` expectation to `["0008_artifacts_and_sharing", "0009_thread_agents_events_and_approvals"]`
- Update `totalMigrationCount` to `9`

- [ ] **Step 4: Add table and index verification to "applies 0005 through..." test**

Rename test to `"applies 0005_thread_core through 0009_thread_agents_events_and_approvals on a fresh database"` and add the following assertions at the end:

```typescript
    // Verify thread_event_logs table
    const eventLogColumns = database
      .prepare("PRAGMA table_info(thread_event_logs)")
      .all() as Array<{ name: string }>
    expect(eventLogColumns.map((c) => c.name)).toEqual([
      "log_id",
      "project_id",
      "thread_id",
      "event_id",
      "agent_id",
      "agent_type",
      "stream",
      "chunk_index",
      "chunk_text",
      "created_at",
    ])

    // Verify thread_agents table
    const agentColumns = database
      .prepare("PRAGMA table_info(thread_agents)")
      .all() as Array<{ name: string }>
    expect(agentColumns.map((c) => c.name)).toEqual([
      "agent_id",
      "thread_id",
      "parent_agent_id",
      "agent_type",
      "display_name",
      "status",
      "summary",
      "work_item_ref",
      "started_at",
      "updated_at",
      "finished_at",
    ])

    // Verify thread_file_changes table
    const fileChangeColumns = database
      .prepare("PRAGMA table_info(thread_file_changes)")
      .all() as Array<{ name: string }>
    expect(fileChangeColumns.map((c) => c.name)).toEqual([
      "thread_id",
      "path",
      "change_type",
      "old_path",
      "additions",
      "deletions",
      "updated_at",
    ])

    // Verify approvals table
    const approvalColumns = database
      .prepare("PRAGMA table_info(approvals)")
      .all() as Array<{ name: string }>
    expect(approvalColumns.map((c) => c.name)).toEqual([
      "approval_id",
      "project_id",
      "thread_id",
      "approval_type",
      "status",
      "title",
      "description",
      "payload_json",
      "requested_at",
      "resolved_at",
      "resolved_by",
    ])

    // Verify all new indexes exist
    const newIndexes = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'index'
            AND name IN (
              'idx_thread_event_logs_thread_created',
              'idx_thread_event_logs_thread_agent',
              'idx_thread_agents_thread_status',
              'idx_thread_file_changes_thread',
              'idx_approvals_thread_status',
              'idx_approvals_project_status'
            )
          ORDER BY name ASC
        `,
      )
      .all() as Array<{ name: string }>
    expect(newIndexes).toEqual([
      { name: "idx_approvals_project_status" },
      { name: "idx_approvals_thread_status" },
      { name: "idx_thread_agents_thread_status" },
      { name: "idx_thread_event_logs_thread_agent" },
      { name: "idx_thread_event_logs_thread_created" },
      { name: "idx_thread_file_changes_thread" },
    ])
```

Also add `expect(result.appliedMigrationIds).toContain("0009_thread_agents_events_and_approvals")` and update `totalMigrationCount` to `9`.

- [ ] **Step 5: Run tests to verify table/index assertions pass**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/backend exec vitest run src/db/migrator.test.ts`

Expected: Existing tests pass with updated counts. New assertions pass.

- [ ] **Step 6: Add FK constraint tests for new tables**

Add the following tests **inside** the existing `describe("thread core FK constraints")` block (before its closing `})`), since the `createMigratedDatabase`, `insertProject`, `insertChat`, `insertThread` helpers are scoped within that block.

Add helper functions inside the new describe:

```typescript
  function insertThreadEvent(
    database: DatabaseSync,
    eventId = "event_1",
    projectId = "proj_1",
    threadId = "thread_1",
  ): void {
    database
      .prepare(
        "INSERT INTO thread_events (event_id, project_id, thread_id, sequence_number, event_type, actor_type, source, payload_json, occurred_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        eventId,
        projectId,
        threadId,
        1,
        "thread.created",
        "system",
        "ultra.backend",
        '{"type":"created"}',
        "2026-03-17T00:00:00Z",
        "2026-03-17T00:00:00Z",
      )
  }
```

Add the following tests:

```typescript
  it("rejects a thread_event_log with nonexistent thread_id", () => {
    const database = createMigratedDatabase()
    insertProject(database)

    expect(() =>
      database
        .prepare(
          "INSERT INTO thread_event_logs (log_id, project_id, thread_id, event_id, stream, chunk_index, chunk_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("log_1", "proj_1", "nonexistent", null, "stdout", 0, "hello", "2026-03-17T00:00:00Z"),
    ).toThrow()

    database.close()
  })

  it("sets event_id to null when referenced thread_event is deleted", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)
    insertThreadEvent(database)

    database
      .prepare(
        "INSERT INTO thread_event_logs (log_id, project_id, thread_id, event_id, stream, chunk_index, chunk_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("log_1", "proj_1", "thread_1", "event_1", "stdout", 0, "output", "2026-03-17T00:00:00Z")

    database.prepare("DELETE FROM thread_events WHERE event_id = ?").run("event_1")

    const log = database
      .prepare("SELECT log_id, event_id FROM thread_event_logs WHERE log_id = ?")
      .get("log_1") as { log_id: string; event_id: string | null }
    expect(log.event_id).toBeNull()

    database.close()
  })

  it("cascades thread deletion to thread_agents", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database
      .prepare(
        "INSERT INTO thread_agents (agent_id, thread_id, agent_type, display_name, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("agent_1", "thread_1", "coordinator", "Main Agent", "running", "2026-03-17T00:00:00Z")

    database.prepare("DELETE FROM threads WHERE id = ?").run("thread_1")

    const agents = database
      .prepare("SELECT agent_id FROM thread_agents")
      .all() as Array<{ agent_id: string }>
    expect(agents).toEqual([])

    database.close()
  })

  it("sets parent_agent_id to null when parent agent is deleted", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database
      .prepare(
        "INSERT INTO thread_agents (agent_id, thread_id, agent_type, display_name, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("parent_1", "thread_1", "coordinator", "Parent", "completed", "2026-03-17T00:00:00Z")

    database
      .prepare(
        "INSERT INTO thread_agents (agent_id, thread_id, parent_agent_id, agent_type, display_name, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("child_1", "thread_1", "parent_1", "worker", "Child", "running", "2026-03-17T00:00:00Z")

    database.prepare("DELETE FROM thread_agents WHERE agent_id = ?").run("parent_1")

    const child = database
      .prepare("SELECT agent_id, parent_agent_id FROM thread_agents WHERE agent_id = ?")
      .get("child_1") as { agent_id: string; parent_agent_id: string | null }
    expect(child.parent_agent_id).toBeNull()

    database.close()
  })

  it("cascades thread deletion to thread_file_changes", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database
      .prepare(
        "INSERT INTO thread_file_changes (thread_id, path, change_type, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("thread_1", "src/main.ts", "modified", "2026-03-17T00:00:00Z")

    database.prepare("DELETE FROM threads WHERE id = ?").run("thread_1")

    const changes = database
      .prepare("SELECT * FROM thread_file_changes")
      .all() as Array<{ thread_id: string }>
    expect(changes).toEqual([])

    database.close()
  })

  it("rejects duplicate thread_file_changes for same thread and path", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database
      .prepare(
        "INSERT INTO thread_file_changes (thread_id, path, change_type, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("thread_1", "src/main.ts", "modified", "2026-03-17T00:00:00Z")

    expect(() =>
      database
        .prepare(
          "INSERT INTO thread_file_changes (thread_id, path, change_type, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run("thread_1", "src/main.ts", "deleted", "2026-03-17T00:01:00Z"),
    ).toThrow()

    database.close()
  })

  it("allows same path for different threads in thread_file_changes", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database, "thread_1")
    insertThread(database, "thread_2", "proj_1", "chat_1")

    database
      .prepare(
        "INSERT INTO thread_file_changes (thread_id, path, change_type, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("thread_1", "src/main.ts", "modified", "2026-03-17T00:00:00Z")

    database
      .prepare(
        "INSERT INTO thread_file_changes (thread_id, path, change_type, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("thread_2", "src/main.ts", "added", "2026-03-17T00:00:00Z")

    const changes = database
      .prepare("SELECT thread_id, path FROM thread_file_changes ORDER BY thread_id")
      .all() as Array<{ thread_id: string; path: string }>
    expect(changes).toHaveLength(2)

    database.close()
  })

  it("cascades thread deletion to approvals", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)

    database
      .prepare(
        "INSERT INTO approvals (approval_id, project_id, thread_id, approval_type, status, title, payload_json, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("approval_1", "proj_1", "thread_1", "review", "pending", "Review thread work", '{}', "2026-03-17T00:00:00Z")

    database.prepare("DELETE FROM threads WHERE id = ?").run("thread_1")

    const approvals = database
      .prepare("SELECT approval_id FROM approvals")
      .all() as Array<{ approval_id: string }>
    expect(approvals).toEqual([])

    database.close()
  })

  it("cascades project deletion through threads to all child tables", () => {
    const database = createMigratedDatabase()
    insertProject(database)
    insertChat(database)
    insertThread(database)
    insertThreadEvent(database)

    // Insert data into all four new tables
    database
      .prepare(
        "INSERT INTO thread_event_logs (log_id, project_id, thread_id, event_id, stream, chunk_index, chunk_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("log_1", "proj_1", "thread_1", "event_1", "stdout", 0, "output", "2026-03-17T00:00:00Z")

    database
      .prepare(
        "INSERT INTO thread_agents (agent_id, thread_id, agent_type, display_name, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("agent_1", "thread_1", "coordinator", "Main", "running", "2026-03-17T00:00:00Z")

    database
      .prepare(
        "INSERT INTO thread_file_changes (thread_id, path, change_type, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("thread_1", "src/main.ts", "modified", "2026-03-17T00:00:00Z")

    database
      .prepare(
        "INSERT INTO approvals (approval_id, project_id, thread_id, approval_type, status, title, payload_json, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("approval_1", "proj_1", "thread_1", "review", "pending", "Review", '{}', "2026-03-17T00:00:00Z")

    // Delete the project — everything should cascade
    database.prepare("DELETE FROM projects WHERE id = ?").run("proj_1")

    expect(database.prepare("SELECT * FROM thread_event_logs").all()).toEqual([])
    expect(database.prepare("SELECT * FROM thread_agents").all()).toEqual([])
    expect(database.prepare("SELECT * FROM thread_file_changes").all()).toEqual([])
    expect(database.prepare("SELECT * FROM approvals").all()).toEqual([])

    database.close()
  })
```

- [ ] **Step 7: Run migration tests**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/backend exec vitest run src/db/migrator.test.ts`

Expected: All tests pass.

- [ ] **Step 8: Commit migration tests**

```bash
git add apps/backend/src/db/migrator.test.ts
git commit -m "test(db): add migration 0009 tests for table creation, FK constraints, and cascades"
```

---

## Task 4: Add shared contract tests

**Files:**
- Modify: `packages/shared/src/index.test.ts`

- [ ] **Step 1: Add import for new parse functions**

Add to the imports at the top of `packages/shared/src/index.test.ts`:

```typescript
  parseApprovalSnapshot,
  parseThreadAgentSnapshot,
  parseThreadEventLogSnapshot,
  parseThreadFileChangeSnapshot,
```

- [ ] **Step 2: Add parse tests**

Add the following tests inside the `"shared contracts"` describe block:

```typescript
  it("parses thread event log snapshots", () => {
    const log = parseThreadEventLogSnapshot({
      logId: "log_1",
      projectId: "proj_1",
      threadId: "thread_1",
      eventId: "event_1",
      agentId: "agent_1",
      agentType: "coordinator",
      stream: "stdout",
      chunkIndex: 0,
      chunkText: "Building project...",
      createdAt: "2026-03-17T00:00:00Z",
    })
    expect(log.stream).toBe("stdout")
    expect(log.chunkIndex).toBe(0)
  })

  it("parses thread event log snapshots with null optional fields", () => {
    const log = parseThreadEventLogSnapshot({
      logId: "log_2",
      projectId: "proj_1",
      threadId: "thread_1",
      eventId: null,
      agentId: null,
      agentType: null,
      stream: "stderr",
      chunkIndex: 5,
      chunkText: "Warning: unused variable",
      createdAt: "2026-03-17T00:00:00Z",
    })
    expect(log.eventId).toBeNull()
    expect(log.agentId).toBeNull()
  })

  it("parses thread agent snapshots", () => {
    const agent = parseThreadAgentSnapshot({
      agentId: "agent_1",
      threadId: "thread_1",
      parentAgentId: null,
      agentType: "coordinator",
      displayName: "Main Coordinator",
      status: "running",
      summary: null,
      workItemRef: null,
      startedAt: "2026-03-17T00:00:00Z",
      updatedAt: "2026-03-17T00:00:00Z",
      finishedAt: null,
    })
    expect(agent.status).toBe("running")
    expect(agent.displayName).toBe("Main Coordinator")
  })

  it("rejects invalid thread agent status", () => {
    expect(() =>
      parseThreadAgentSnapshot({
        agentId: "agent_1",
        threadId: "thread_1",
        parentAgentId: null,
        agentType: "coordinator",
        displayName: "Agent",
        status: "unknown_status",
        summary: null,
        workItemRef: null,
        startedAt: null,
        updatedAt: "2026-03-17T00:00:00Z",
        finishedAt: null,
      }),
    ).toThrow()
  })

  it("parses thread file change snapshots", () => {
    const change = parseThreadFileChangeSnapshot({
      threadId: "thread_1",
      path: "src/main.ts",
      changeType: "modified",
      oldPath: null,
      additions: 15,
      deletions: 3,
      updatedAt: "2026-03-17T00:00:00Z",
    })
    expect(change.changeType).toBe("modified")
    expect(change.additions).toBe(15)
  })

  it("parses thread file change with rename", () => {
    const change = parseThreadFileChangeSnapshot({
      threadId: "thread_1",
      path: "src/utils/new-name.ts",
      changeType: "renamed",
      oldPath: "src/utils/old-name.ts",
      additions: null,
      deletions: null,
      updatedAt: "2026-03-17T00:00:00Z",
    })
    expect(change.changeType).toBe("renamed")
    expect(change.oldPath).toBe("src/utils/old-name.ts")
  })

  it("rejects invalid file change type", () => {
    expect(() =>
      parseThreadFileChangeSnapshot({
        threadId: "thread_1",
        path: "src/main.ts",
        changeType: "moved",
        oldPath: null,
        additions: null,
        deletions: null,
        updatedAt: "2026-03-17T00:00:00Z",
      }),
    ).toThrow()
  })

  it("parses approval snapshots", () => {
    const approval = parseApprovalSnapshot({
      approvalId: "approval_1",
      projectId: "proj_1",
      threadId: "thread_1",
      approvalType: "review",
      status: "pending",
      title: "Review thread implementation",
      description: "Please review the changes made by the coordinator.",
      payload: { diffUrl: "https://example.com/diff" },
      requestedAt: "2026-03-17T00:00:00Z",
      resolvedAt: null,
      resolvedBy: null,
    })
    expect(approval.approvalType).toBe("review")
    expect(approval.status).toBe("pending")
  })

  it("parses resolved approval snapshots", () => {
    const approval = parseApprovalSnapshot({
      approvalId: "approval_2",
      projectId: "proj_1",
      threadId: "thread_1",
      approvalType: "spec",
      status: "approved",
      title: "Approve spec",
      description: null,
      payload: {},
      requestedAt: "2026-03-17T00:00:00Z",
      resolvedAt: "2026-03-17T01:00:00Z",
      resolvedBy: "user_1",
    })
    expect(approval.status).toBe("approved")
    expect(approval.resolvedBy).toBe("user_1")
  })

  it("rejects invalid approval type", () => {
    expect(() =>
      parseApprovalSnapshot({
        approvalId: "approval_3",
        projectId: "proj_1",
        threadId: "thread_1",
        approvalType: "deployment",
        status: "pending",
        title: "Deploy",
        description: null,
        payload: {},
        requestedAt: "2026-03-17T00:00:00Z",
        resolvedAt: null,
        resolvedBy: null,
      }),
    ).toThrow()
  })

  it("rejects invalid approval status", () => {
    expect(() =>
      parseApprovalSnapshot({
        approvalId: "approval_4",
        projectId: "proj_1",
        threadId: "thread_1",
        approvalType: "review",
        status: "in_progress",
        title: "Review",
        description: null,
        payload: {},
        requestedAt: "2026-03-17T00:00:00Z",
        resolvedAt: null,
        resolvedBy: null,
      }),
    ).toThrow()
  })
```

- [ ] **Step 3: Run shared package tests**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/shared exec vitest run src/index.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Commit shared contract tests**

```bash
git add packages/shared/src/index.test.ts
git commit -m "test(shared): add parse tests for thread event log, agent, file change, and approval schemas"
```

---

## Task 5: Full test suite verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/backend exec vitest run`

Expected: All tests pass.

- [ ] **Step 2: Run full shared test suite**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/shared exec vitest run`

Expected: All tests pass.

- [ ] **Step 3: Verify TypeScript compiles cleanly**

Run: `cd /Users/tony/Projects/ultra && pnpm --filter @ultra/shared exec tsc --noEmit && pnpm --filter @ultra/backend exec tsc --noEmit`

Expected: No type errors.
