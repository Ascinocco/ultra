# ULR-73: Thread Events, Agents, and Approvals Migrations

**Date:** 2026-03-17
**Ticket:** [ULR-73](https://linear.app/ulra-agentic-ide/issue/ULR-73)
**Milestone:** M2 Chat and Thread Core
**Unblocks:** ULR-34, ULR-84, ULR-44, ULR-20, ULR-26

## Objective

Add four tables to support thread execution observability and review workflows: `thread_event_logs`, `thread_agents`, `thread_file_changes`, and `approvals`. Add corresponding Zod snapshot schemas in the shared contracts package.

## Scope

**In scope:**
- Migration `0009_thread_agents_events_and_approvals` (4 tables + indexes)
- Zod snapshot schemas in `packages/shared/src/contracts/`
- Migration tests in `apps/backend/src/db/migrator.test.ts`
- Re-exports from `packages/shared/src/index.ts`

**Out of scope:**
- Service layer implementations (ThreadAgentService, ApprovalService, etc.)
- IPC wiring and query/command schemas
- UI components
- These belong to ULR-34, ULR-84, and downstream tickets

## Existing State

`thread_events` already exists via migration `0007_thread_events_foundation`. The ticket description mentions it but it does not need to be created again. The latest migration is `0008_artifacts_and_sharing`.

## Migration: `0009_thread_agents_events_and_approvals`

Single migration creating all four tables. All use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotency.

### `thread_event_logs`

Raw output chunks from coordinator/agent execution, linked to thread events.

```sql
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
```

**FK behavior:**
- `project_id` → CASCADE (project deletion removes all logs)
- `thread_id` → CASCADE (thread deletion removes all logs)
- `event_id` → SET NULL (event deletion preserves log with null reference)

### `thread_agents`

Sub-agent lifecycle tracking within a thread.

```sql
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
```

**FK behavior:**
- `thread_id` → CASCADE (thread deletion removes all agents)
- `parent_agent_id` → SET NULL (parent deletion preserves child with null parent)

### `thread_file_changes`

File-level diff tracking per thread. Composite primary key on `(thread_id, path)`.

```sql
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
```

**FK behavior:**
- `thread_id` → CASCADE (thread deletion removes all file changes)

### `approvals`

Review workflow records for plan, spec, review, and publish approval flows.

```sql
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
```

**FK behavior:**
- `project_id` → CASCADE (project deletion removes all approvals)
- `thread_id` → CASCADE (thread deletion removes all approvals)

## Zod Contracts

### Thread contracts (`packages/shared/src/contracts/threads.ts`)

Added alongside existing `threadEventSnapshotSchema`:

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
  createdAt: z.string(),
})
export type ThreadEventLogSnapshot = z.infer<typeof threadEventLogSnapshotSchema>

// ── Thread Agents ────────────────────────────────────────────────────
export const threadAgentStatusSchema = z.enum([
  'pending', 'running', 'completed', 'failed', 'cancelled',
])
export type ThreadAgentStatus = z.infer<typeof threadAgentStatusSchema>

export const threadAgentSnapshotSchema = z.object({
  agentId: z.string(),
  threadId: opaqueIdSchema,
  parentAgentId: z.string().nullable(),
  agentType: z.string(),
  displayName: z.string(),
  status: threadAgentStatusSchema,
  summary: z.string().nullable(),
  workItemRef: z.string().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type ThreadAgentSnapshot = z.infer<typeof threadAgentSnapshotSchema>

// ── Thread File Changes ──────────────────────────────────────────────
export const fileChangeTypeSchema = z.enum([
  'added', 'modified', 'deleted', 'renamed',
])
export type FileChangeType = z.infer<typeof fileChangeTypeSchema>

export const threadFileChangeSnapshotSchema = z.object({
  threadId: opaqueIdSchema,
  path: z.string(),
  changeType: fileChangeTypeSchema,
  oldPath: z.string().nullable(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  updatedAt: z.string(),
})
export type ThreadFileChangeSnapshot = z.infer<typeof threadFileChangeSnapshotSchema>
```

### Approvals contract (`packages/shared/src/contracts/approvals.ts`)

New file — approvals are a distinct domain concept from threads.

```typescript
import { z } from "zod"
import { opaqueIdSchema } from "./constants.js"
import { projectIdSchema } from "./projects.js"
import { threadIdSchema } from "./threads.js"

export const approvalTypeSchema = z.enum([
  'plan', 'spec', 'review', 'publish',
])
export type ApprovalType = z.infer<typeof approvalTypeSchema>

export const approvalStatusSchema = z.enum([
  'pending', 'approved', 'rejected', 'cancelled',
])
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>

export const approvalSnapshotSchema = z.object({
  approvalId: z.string(),
  projectId: projectIdSchema,
  threadId: threadIdSchema,
  approvalType: approvalTypeSchema,
  status: approvalStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  requestedAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
})
export type ApprovalSnapshot = z.infer<typeof approvalSnapshotSchema>

export function parseApprovalSnapshot(input: unknown): ApprovalSnapshot {
  return approvalSnapshotSchema.parse(input)
}
```

### Re-exports from `packages/shared/src/index.ts`

Add type and value exports for all new schemas from both `threads.ts` and the new `approvals.ts`.

## Tests

All tests added to `apps/backend/src/db/migrator.test.ts` following existing patterns.

### Migration application
- All 4 tables created (verified via `PRAGMA table_info()`)
- All indexes created (verified via `sqlite_master WHERE type='index'`)
- Migration recorded in `schema_migrations`
- Idempotent — running full migrations twice is a no-op

### FK constraint enforcement
- `thread_event_logs.thread_id` → insert with nonexistent thread throws
- `thread_event_logs.event_id` → SET NULL on event delete (insert log referencing event, delete event, verify log persists with null event_id)
- `thread_agents.thread_id` → CASCADE on thread delete (insert agent, delete thread, verify agent gone)
- `thread_agents.parent_agent_id` → SET NULL on parent delete (insert parent + child, delete parent, verify child persists with null parent)
- `thread_file_changes.thread_id` → CASCADE on thread delete
- `approvals.thread_id` → CASCADE on thread delete
- `approvals.project_id` → CASCADE on project delete

### Composite PK
- `thread_file_changes(thread_id, path)` — duplicate insert throws
- Same path for different threads succeeds

### Cascade chain
- Delete a project → cascades to threads → cascades to all child rows (agents, logs, file_changes, approvals)

## File Changes Summary

| File | Change |
|------|--------|
| `apps/backend/src/db/migrations.ts` | Add migration `0009_thread_agents_events_and_approvals` |
| `apps/backend/src/db/migrator.test.ts` | Add tests for new migration |
| `packages/shared/src/contracts/threads.ts` | Add thread event log, agent, and file change schemas |
| `packages/shared/src/contracts/approvals.ts` | New file — approval snapshot schema |
| `packages/shared/src/index.ts` | Re-export new schemas and types |
