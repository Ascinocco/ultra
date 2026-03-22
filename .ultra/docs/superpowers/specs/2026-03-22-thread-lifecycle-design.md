# Thread Lifecycle Actions — Design Spec

**Ticket:** ULR-104
**Date:** 2026-03-22
**Status:** Approved

## Goal

Add lifecycle action buttons (Approve, Archive, Retry) to the thread detail header so users can complete the review loop and manage thread state.

## State Model (Existing)

Two-axis model already implemented:

- **executionState**: queued, starting, running, blocked, awaiting_review, completed, failed, finishing, canceled
- **reviewState**: not_ready, ready, in_review, changes_requested, approved

The coordinator sets executionState and reviewState. The user sets them via lifecycle actions.

## New: Archived Flag

New boolean column `archived` on the threads table (default `false`). Archiving is orthogonal to execution/review state — a thread can be archived in any terminal state.

### Migration

Migration ID: `0016_thread_archived_flag`

```sql
ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
```

Note: The `archived` column must also be added to `ThreadRow` type, `mapThreadRow` function, all SELECT queries (listAll, listByProject, listByChat, getThreadSnapshot, etc.), and the threadSummarySchema in shared contracts.

## State Transitions

```
queued → starting → running → awaiting_review → completed (approved)
                       ↑            |                  |
                       |            ↓                  ↓
                       |      (user sends msg)    (user sends msg)
                       |            |                  |
                       ←────────────←──────────────────←

                   running → failed
                               |
                          (retry) → running

Any terminal state → archived (explicit button)
archived → unarchived (from archive filter)
```

## User Actions

| Action | When Available | executionState After | reviewState After | Other |
|--------|---------------|---------------------|-------------------|-------|
| Approve | `awaiting_review` | `completed` | `approved` | — |
| Archive | `awaiting_review`, `completed`, `failed`, `canceled` | (unchanged) | (unchanged) | `archived = true` |
| Unarchive | any archived thread | (unchanged) | (unchanged) | `archived = false` |
| Retry | `failed` | `running` | `not_ready` | Calls `startCoordinator()` |
| Send message | `awaiting_review`, `completed`, `blocked` | `running` | `not_ready` | Resumes coordinator via existing `threads.send_message` |

Note: "Request Changes" is not a separate button. The user just types in the input dock and sends — this resumes the coordinator and moves the thread back to `running` automatically.

## Header Actions UI

Small buttons in the thread detail header, right-aligned next to the state pill. They change based on thread state:

| executionState | Buttons Shown |
|---------------|---------------|
| `running` | (none — stop button is in input dock) |
| `blocked` | (none — input dock is enabled) |
| `awaiting_review` | Approve · Archive |
| `completed` | Archive |
| `failed` | Retry · Archive |
| `canceled` | Retry · Archive |

Archived threads show: Unarchive

Button style: small, outlined, muted color. Not prominent — the conversation is the focus.

## Thread List Filtering

- Thread list filters out archived threads by default
- Small "Show archived" toggle in the thread pane list header
- Archived threads render dimmed when visible
- Clicking an archived thread opens it read-only with Unarchive button

## Backend

### New IPC Commands

**`threads.approve`**
- Input: `{ thread_id: string }`
- Effect: Set `executionState: "completed"`, `reviewState: "approved"`
- Returns: Updated thread snapshot

**`threads.archive`**
- Input: `{ thread_id: string }`
- Effect: Set `archived: true`
- Returns: Updated thread snapshot

**`threads.unarchive`**
- Input: `{ thread_id: string }`
- Effect: Set `archived: false`
- Returns: Updated thread snapshot

**`threads.retry`**
- Input: `{ thread_id: string }`
- Effect: Reset `executionState: "queued"`, `reviewState: "not_ready"`, clear `failure_reason`. Then call `threadTurnService.startCoordinator(threadId)`.
- Returns: Updated thread snapshot
- Note: Replaces the existing `runtime.retry_thread` command (which went through CoordinatorService and assumed a running process). The new command spawns a fresh coordinator session, which is correct for failed threads where the process has exited.

### ThreadService Methods

- `approveThread(threadId)` — sets executionState to `completed`, reviewState to `approved`, sets `approvedAt` and `completedAt` timestamps
- `archiveThread(threadId)` — sets archived flag
- `unarchiveThread(threadId)` — clears archived flag
- `retryThread(threadId)` — resets state for retry

### Send Message State Reset

The existing `sendMessage` flow in ThreadService already dispatches to the coordinator. When the coordinator resumes, `ThreadTurnService.sendMessage()` sets executionState to `running`. No additional work needed for the "send message reopens thread" behavior.

## Frontend

### ThreadDetail.tsx

Render action buttons in the header based on thread state:

```tsx
<div className="thread-detail__actions">
  {thread.executionState === "awaiting_review" && (
    <>
      <button className="thread-action thread-action--approve" onClick={onApprove}>Approve</button>
      <button className="thread-action" onClick={onArchive}>Archive</button>
    </>
  )}
  {thread.executionState === "completed" && !thread.archived && (
    <button className="thread-action" onClick={onArchive}>Archive</button>
  )}
  {thread.executionState === "failed" && (
    <>
      <button className="thread-action thread-action--retry" onClick={onRetry}>Retry</button>
      <button className="thread-action" onClick={onArchive}>Archive</button>
    </>
  )}
  {thread.archived && (
    <button className="thread-action" onClick={onUnarchive}>Unarchive</button>
  )}
</div>
```

### ThreadPane.tsx

- Add `showArchived` toggle state
- Filter threads: `threads.filter(t => showArchived || !t.archived)`
- Archived threads render with `.thread-card--archived` class (dimmed)

### thread-workflows.ts

New workflow functions:
- `approveThread(threadId)`
- `archiveThread(threadId)`
- `unarchiveThread(threadId)`
- `retryThread(threadId)`

Each sends the corresponding IPC command and refreshes the thread list.

## Files

### Modified
- `apps/backend/src/db/migrations.ts` — migration for `archived` column
- `apps/backend/src/threads/thread-service.ts` — approve/archive/unarchive/retry methods
- `apps/backend/src/ipc/router.ts` — new command handlers
- `packages/shared/src/contracts/ipc.ts` — new command methods in commandMethodSchema
- `packages/shared/src/contracts/threads.ts` — add `archived` to thread snapshot schema
- `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx` — action buttons in header
- `apps/desktop/src/renderer/src/threads/ThreadPane.tsx` — archive filter toggle
- `apps/desktop/src/renderer/src/threads/thread-workflows.ts` — new workflow functions
- `apps/desktop/src/renderer/src/styles/app.css` — thread action button styles
- `apps/backend/src/index.ts` — pass threadTurnService to router for retry

## Out of Scope

- Merge/PR creation on approve (user does this manually via chat)
- Completion report back to main chat (user asks via chat)
- Bulk archive/approve operations
- Thread deletion (archive is sufficient)
