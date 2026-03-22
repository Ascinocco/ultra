# Thread Lifecycle Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Approve, Archive, Retry lifecycle buttons to the thread detail header so users can complete the review loop and manage thread state.

**Architecture:** New `archived` column via migration 0016. Four new IPC commands (approve, archive, unarchive, retry) with corresponding ThreadService methods and router handlers. Frontend renders contextual action buttons in the thread header based on executionState, with archive filtering in the thread list.

**Tech Stack:** SQLite migrations, Zod contracts, IPC router, React components, CSS

---

## File Structure

### Modified Files
- `apps/backend/src/db/migrations.ts` — Migration 0016: archived column
- `packages/shared/src/contracts/threads.ts:63-96` — Add `archived` to threadSummarySchema
- `packages/shared/src/contracts/ipc.ts:40-76` — Add 4 new command methods
- `apps/backend/src/threads/thread-service.ts` — ThreadRow type, mapThreadRow, SELECT queries, 4 new methods
- `apps/backend/src/ipc/router.ts:252,891-896` — Widen threadTurnService type, add 4 command handlers
- `apps/desktop/src/renderer/src/threads/thread-workflows.ts` — 4 new workflow functions
- `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx:60-153` — Action buttons in header
- `apps/desktop/src/renderer/src/threads/ThreadPane.tsx:96-109` — Archive filter toggle
- `apps/desktop/src/renderer/src/styles/app.css` — Action button + archived styles
- `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` — Wire lifecycle handlers

---

### Task 1: Migration 0016 — archived column

**Files:**
- Modify: `apps/backend/src/db/migrations.ts`

- [ ] **Step 1: Add migration 0016**

After the last migration (`0015_thread_vendor_session`), add:

```typescript
{
  id: "0016_thread_archived_flag",
  sql: `ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`,
},
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/backend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/migrations.ts
git commit -m "feat: add migration 0016 for thread archived column"
```

---

### Task 2: Update shared contracts

**Files:**
- Modify: `packages/shared/src/contracts/threads.ts:63-96`
- Modify: `packages/shared/src/contracts/ipc.ts:40-76`

- [ ] **Step 1: Add `archived` to threadSummarySchema**

In `packages/shared/src/contracts/threads.ts`, the `threadSummarySchema` (line 63) has fields ending with `completedAt`. Add `archived` after `completedAt`:

```typescript
archived: z.boolean(),
```

Note: SQLite stores it as INTEGER (0/1) but the mapThreadRow function will convert it to boolean.

- [ ] **Step 2: Add 4 new commands to commandMethodSchema**

In `packages/shared/src/contracts/ipc.ts`, add after `"threads.cancel_coordinator"` (line 60):

```typescript
"threads.approve",
"threads.archive",
"threads.unarchive",
"threads.retry",
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/tony/Projects/ultra/packages/shared && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/contracts/threads.ts packages/shared/src/contracts/ipc.ts
git commit -m "feat: add archived field to thread schema and lifecycle IPC commands"
```

---

### Task 3: ThreadService — archived field + lifecycle methods

**Files:**
- Modify: `apps/backend/src/threads/thread-service.ts`

This is the largest task. The `archived` field must be added to:
1. `ThreadRow` type (line 43-74)
2. `mapThreadRow` function (line 151-184)
3. All SELECT queries that enumerate thread columns
4. Four new methods: approveThread, archiveThread, unarchiveThread, retryThread

- [ ] **Step 1: Add `archived` to ThreadRow type**

After `completed_at: string | null` in the ThreadRow type (around line 73), add:

```typescript
archived: number  // SQLite boolean: 0 or 1
```

- [ ] **Step 2: Update mapThreadRow to include archived**

In the `mapThreadRow` function (around line 183), add before the closing brace:

```typescript
archived: Boolean(row.archived),
```

- [ ] **Step 3: Add `archived` to ALL SELECT queries**

Search the file for all `SELECT` statements that list thread columns. There are at least 6:
- `listAll()`
- `listByProject()`
- `listByChat()`
- `getThreadSnapshot()`
- `getThreadByCreatedByMessageId()`
- Any others

For each, add `archived` to the column list after `completed_at`. Example:

```sql
completed_at,
archived
```

**IMPORTANT:** Read the actual file first to find ALL SELECT queries. Search for `FROM threads` to find them all.

- [ ] **Step 4: Add approveThread method**

```typescript
approveThread(threadId: ThreadId): void {
  const timestamp = this.now()
  this.database
    .prepare(
      `UPDATE threads
       SET execution_state = 'completed',
           review_state = 'approved',
           approved_at = ?,
           completed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(timestamp, timestamp, timestamp, threadId)
}
```

- [ ] **Step 5: Add archiveThread method**

```typescript
archiveThread(threadId: ThreadId): void {
  this.database
    .prepare(
      `UPDATE threads SET archived = 1, updated_at = ? WHERE id = ?`,
    )
    .run(this.now(), threadId)
}
```

- [ ] **Step 6: Add unarchiveThread method**

```typescript
unarchiveThread(threadId: ThreadId): void {
  this.database
    .prepare(
      `UPDATE threads SET archived = 0, updated_at = ? WHERE id = ?`,
    )
    .run(this.now(), threadId)
}
```

- [ ] **Step 7: Add retryThread method**

```typescript
retryThread(threadId: ThreadId): void {
  this.database
    .prepare(
      `UPDATE threads
       SET execution_state = 'queued',
           review_state = 'not_ready',
           failure_reason = NULL,
           restart_count = restart_count + 1,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(this.now(), threadId)
}
```

- [ ] **Step 8: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/backend && npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/threads/thread-service.ts
git commit -m "feat: add archived field and lifecycle methods to ThreadService"
```

---

### Task 4: IPC router — lifecycle command handlers

**Files:**
- Modify: `apps/backend/src/ipc/router.ts`

- [ ] **Step 1: Widen threadTurnService type**

The router's services type (line 252) currently has:
```typescript
threadTurnService?: { cancelCoordinator: (threadId: string) => void }
```

Update to:
```typescript
threadTurnService?: {
  cancelCoordinator: (threadId: string) => void
  startCoordinator: (threadId: string) => Promise<void>
}
```

- [ ] **Step 2: Add 4 command handlers**

After the `threads.cancel_coordinator` case (around line 896), add before `default:`:

```typescript
case "threads.approve": {
  const cmd = assertCommandRequest(request)
  const { thread_id } = cmd.payload as { thread_id: string }
  services.threadService.approveThread(thread_id)
  return createSuccessResponse(cmd.request_id, { approved: true })
}
case "threads.archive": {
  const cmd = assertCommandRequest(request)
  const { thread_id } = cmd.payload as { thread_id: string }
  services.threadService.archiveThread(thread_id)
  return createSuccessResponse(cmd.request_id, { archived: true })
}
case "threads.unarchive": {
  const cmd = assertCommandRequest(request)
  const { thread_id } = cmd.payload as { thread_id: string }
  services.threadService.unarchiveThread(thread_id)
  return createSuccessResponse(cmd.request_id, { unarchived: true })
}
case "threads.retry": {
  const cmd = assertCommandRequest(request)
  const { thread_id } = cmd.payload as { thread_id: string }
  services.threadService.retryThread(thread_id)
  void services.threadTurnService?.startCoordinator(thread_id)
  return createSuccessResponse(cmd.request_id, { retrying: true })
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/backend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/ipc/router.ts
git commit -m "feat: add lifecycle command handlers to IPC router"
```

---

### Task 5: Frontend workflow functions

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/thread-workflows.ts`

- [ ] **Step 1: Add 4 workflow functions**

After the existing `cancelThreadCoordinator` function (around line 101), add:

```typescript
export async function approveThread(
  threadId: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("threads.approve", { thread_id: threadId })
}

export async function archiveThread(
  threadId: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("threads.archive", { thread_id: threadId })
}

export async function unarchiveThread(
  threadId: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("threads.unarchive", { thread_id: threadId })
}

export async function retryThread(
  threadId: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("threads.retry", { thread_id: threadId })
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/thread-workflows.ts
git commit -m "feat: add lifecycle workflow functions"
```

---

### Task 6: ThreadDetail — action buttons in header

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Add lifecycle action props to ThreadDetail**

Add to the component's props:

```typescript
onApprove?: () => void
onArchive?: () => void
onUnarchive?: () => void
onRetry?: () => void
```

- [ ] **Step 2: Render action buttons in the header**

In the `thread-detail__header` div, after the `thread-detail__pills` div, add:

```tsx
<div className="thread-detail__actions">
  {!thread.archived && thread.executionState === "awaiting_review" && (
    <>
      <button className="thread-action thread-action--approve" type="button" onClick={onApprove}>
        Approve
      </button>
      <button className="thread-action" type="button" onClick={onArchive}>
        Archive
      </button>
    </>
  )}
  {!thread.archived && thread.executionState === "completed" && (
    <button className="thread-action" type="button" onClick={onArchive}>
      Archive
    </button>
  )}
  {!thread.archived && (thread.executionState === "failed" || thread.executionState === "canceled") && (
    <>
      <button className="thread-action thread-action--retry" type="button" onClick={onRetry}>
        Retry
      </button>
      <button className="thread-action" type="button" onClick={onArchive}>
        Archive
      </button>
    </>
  )}
  {thread.archived && (
    <button className="thread-action" type="button" onClick={onUnarchive}>
      Unarchive
    </button>
  )}
</div>
```

- [ ] **Step 3: Add CSS for action buttons**

In `apps/desktop/src/renderer/src/styles/app.css`, add after the thread detail header styles:

```css
.thread-detail__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.thread-action {
  appearance: none;
  background: transparent;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.7rem;
  padding: 3px 8px;
  white-space: nowrap;
}

.thread-action:hover {
  border-color: var(--text-muted);
  color: var(--text-secondary);
}

.thread-action--approve {
  border-color: rgba(110, 231, 183, 0.3);
  color: #6ee7b7;
}

.thread-action--approve:hover {
  border-color: #6ee7b7;
  background: rgba(110, 231, 183, 0.08);
}

.thread-action--retry {
  border-color: rgba(250, 204, 21, 0.3);
  color: #f0c674;
}

.thread-action--retry:hover {
  border-color: #f0c674;
  background: rgba(250, 204, 21, 0.08);
}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/ThreadDetail.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "feat: add lifecycle action buttons to thread detail header"
```

---

### Task 7: ThreadPane — archive filter + dimming

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/ThreadPane.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Add archive filter state and toggle**

Import `useState` if not already imported. Add state:

```typescript
const [showArchived, setShowArchived] = useState(false)
```

Filter threads before rendering the list:

```typescript
const visibleThreads = showArchived
  ? threads
  : threads.filter((t) => !t.archived)
```

Replace `threads.map(...)` with `visibleThreads.map(...)` in the list render.

- [ ] **Step 2: Add "Show archived" toggle**

Before the thread list div, add a toggle if there are any archived threads:

```tsx
{threads.some((t) => t.archived) && (
  <button
    className="thread-pane__archive-toggle"
    type="button"
    onClick={() => setShowArchived(!showArchived)}
  >
    {showArchived ? "Hide archived" : "Show archived"}
  </button>
)}
```

- [ ] **Step 3: Add CSS for archive toggle and dimming**

```css
.thread-pane__archive-toggle {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  padding: 4px 8px;
  text-align: center;
  width: 100%;
}

.thread-pane__archive-toggle:hover {
  color: var(--text-secondary);
}
```

In ThreadCard rendering, check if `thread.archived` and apply a wrapper class or inline style for dimming. The simplest approach: wrap the ThreadCard in a div with conditional opacity:

```tsx
<div key={thread.id} style={thread.archived ? { opacity: 0.5 } : undefined}>
  <ThreadCard
    thread={thread}
    isSelected={false}
    onSelect={() => onSelectThread(thread.id)}
  />
</div>
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/ThreadPane.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "feat: add archive filter toggle and dimming to thread list"
```

---

### Task 8: Wire lifecycle actions through ThreadPane and ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/ThreadPane.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

- [ ] **Step 1: Add lifecycle callbacks to ThreadPane props**

```typescript
onApprove?: (threadId: string) => void
onArchive?: (threadId: string) => void
onUnarchive?: (threadId: string) => void
onRetry?: (threadId: string) => void
```

Pass through to ThreadDetail:

```typescript
onApprove={onApprove ? () => onApprove(selectedThread.id) : undefined}
onArchive={onArchive ? () => onArchive(selectedThread.id) : undefined}
onUnarchive={onUnarchive ? () => onUnarchive(selectedThread.id) : undefined}
onRetry={onRetry ? () => onRetry(selectedThread.id) : undefined}
```

- [ ] **Step 2: Wire in ChatPageShell**

Import the workflow functions:

```typescript
import {
  approveThread,
  archiveThread,
  unarchiveThread,
  retryThread,
} from "../threads/thread-workflows.js"
```

Add handler functions (near the other thread handlers):

```typescript
function handleApproveThread(threadId: string) {
  void approveThread(threadId).then(() => {
    if (activeProjectId) void fetchThreads(activeProjectId, actions)
  })
}

function handleArchiveThread(threadId: string) {
  void archiveThread(threadId).then(() => {
    if (activeProjectId) void fetchThreads(activeProjectId, actions)
  })
}

function handleUnarchiveThread(threadId: string) {
  void unarchiveThread(threadId).then(() => {
    if (activeProjectId) void fetchThreads(activeProjectId, actions)
  })
}

function handleRetryThread(threadId: string) {
  void retryThread(threadId).then(() => {
    if (activeProjectId) void fetchThreads(activeProjectId, actions)
  })
}
```

Pass to ThreadPane:

```tsx
<ThreadPane
  ... existing props ...
  onApprove={handleApproveThread}
  onArchive={handleArchiveThread}
  onUnarchive={handleUnarchiveThread}
  onRetry={handleRetryThread}
/>
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/ThreadPane.tsx apps/desktop/src/renderer/src/pages/ChatPageShell.tsx
git commit -m "feat: wire lifecycle actions through ThreadPane to ChatPageShell"
```

---

### Task 9: Manual end-to-end verification

- [ ] **Step 1: Start the app, create and promote a thread**

- [ ] **Step 2: Wait for coordinator to finish (awaiting_review)**

Verify: "Approve" and "Archive" buttons appear in thread header.

- [ ] **Step 3: Test Approve**

Click Approve. Verify: state pill changes to "completed", buttons change to just "Archive".

- [ ] **Step 4: Test send message after approve**

Type a message and send. Verify: state moves back to "running", coordinator resumes.

- [ ] **Step 5: Test Archive**

Click Archive. Verify: thread disappears from list. "Show archived" toggle appears. Click it. Thread appears dimmed with "Unarchive" button.

- [ ] **Step 6: Test Unarchive**

Click Unarchive. Verify: thread reappears in normal list.

- [ ] **Step 7: Test Retry on failed thread**

If a thread is in failed state, click Retry. Verify: state resets and coordinator restarts.

- [ ] **Step 8: Commit any fixes**
