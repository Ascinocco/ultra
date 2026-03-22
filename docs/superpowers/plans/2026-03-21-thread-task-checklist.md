# Thread Task Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface coordinator task progress as a live checklist drawer in the thread detail pane, with auto-dismiss and persistence.

**Architecture:** SDK task messages (`task_started`, `task_progress`, `task_notification`) are captured in the Claude adapter as a new `"task_update"` event type, flow through ThreadTurnService to frontend listeners, get persisted to thread_events for history, and render as a collapsible bottom drawer (same pattern as the plan action bar).

**Tech Stack:** Claude Agent SDK system messages, ChatRuntimeEvent, ThreadTurnService, React hooks, CSS

---

## File Structure

### New Files
- `apps/desktop/src/renderer/src/threads/ThreadTaskDrawer.tsx` — Collapsible drawer (lip + expanded checklist)
- `apps/desktop/src/renderer/src/threads/hooks/useThreadTasks.ts` — Derives task state from turn events + persisted events

### Modified Files
- `apps/backend/src/chats/runtime/types.ts:17-23` — Add `"task_update"` to ChatRuntimeEvent union
- `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts:111-116` — Add task message cases to `mapSdkMessage()` system handler
- `apps/backend/src/threads/thread-turn-service.ts:282-313` — Add projectId param, persist task events
- `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx:86-131` — Render TaskDrawer between conversation and InputDock
- `apps/desktop/src/renderer/src/threads/thread-workflows.ts` — Add `fetchThreadTaskEvents`
- `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` — Fetch task events on thread select, pass to ThreadPane/ThreadDetail
- `apps/desktop/src/renderer/src/styles/app.css` — Task drawer styles
- `vendor/superpowers/skills/subagent-driven-development/SKILL.md` — Add completion checklist guidance

---

### Task 1: Add task_update to ChatRuntimeEvent

**Files:**
- Modify: `apps/backend/src/chats/runtime/types.ts:17-23`

- [ ] **Step 1: Add task_update variant to the union**

In `apps/backend/src/chats/runtime/types.ts`, add `task_update` to the `ChatRuntimeEvent` union:

```typescript
export type ChatRuntimeEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_final"; text: string }
  | { type: "tool_activity"; label: string; metadata?: Record<string, unknown> }
  | { type: "task_update"; label: string; metadata?: Record<string, unknown> }
  | { type: "checkpoint_candidate"; checkpoint: ChatRuntimeCheckpointCandidate }
  | { type: "runtime_notice"; message: string }
  | { type: "runtime_error"; message: string }
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/backend && npx tsc --noEmit`
Expected: No new errors (existing callers handle unknown event types gracefully)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/chats/runtime/types.ts
git commit -m "feat: add task_update to ChatRuntimeEvent union"
```

---

### Task 2: Capture SDK task messages in adapter

**Files:**
- Modify: `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts:111-116`

- [ ] **Step 1: Extend the system case in mapSdkMessage**

In `claude-chat-runtime-adapter.ts`, the `case "system"` block (around line 111) currently only handles `subtype === "init"`. Add task lifecycle handling after the init check:

```typescript
case "system": {
  if (msg.subtype === "init" && msg.session_id) {
    vendorSessionId = msg.session_id
  }
  if (msg.subtype === "task_started") {
    events.push({
      type: "task_update",
      label: "task_started",
      metadata: {
        taskId: msg.task_id,
        description: msg.description,
        taskType: msg.task_type,
      },
    })
  }
  if (msg.subtype === "task_progress") {
    events.push({
      type: "task_update",
      label: "task_progress",
      metadata: {
        taskId: msg.task_id,
        description: msg.description,
        summary: msg.summary,
        lastToolName: msg.last_tool_name,
        usage: msg.usage,
      },
    })
  }
  if (msg.subtype === "task_notification") {
    events.push({
      type: "task_update",
      label: "task_notification",
      metadata: {
        taskId: msg.task_id,
        status: msg.status,
        summary: msg.summary,
        usage: msg.usage,
      },
    })
  }
  break
}
```

Note: The `msg` is typed as `any` (line 35: `const msg = message as any`), so accessing these fields is safe without additional type assertions.

- [ ] **Step 2: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/backend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts
git commit -m "feat: capture SDK task_started/progress/notification in adapter"
```

---

### Task 3: Persist task events in ThreadTurnService

**Files:**
- Modify: `apps/backend/src/threads/thread-turn-service.ts:282-313`

- [ ] **Step 1: Update handleCoordinatorEvent signature to accept projectId**

Change the method signature from:
```typescript
private handleCoordinatorEvent(
  threadId: ThreadId,
  event: ChatRuntimeEvent,
): void {
```

To:
```typescript
private handleCoordinatorEvent(
  threadId: ThreadId,
  projectId: ProjectId,
  event: ChatRuntimeEvent,
): void {
```

- [ ] **Step 2: Add task event persistence inside handleCoordinatorEvent**

After the existing event-to-listener dispatch loop (after line 312), add persistence for task events:

```typescript
// Persist task events for history reconstruction
if (event.type === "task_update" && "label" in event) {
  try {
    this.threadService.appendProjectedEvent({
      actorType: "coordinator",
      eventType: event.label.replace("task_", "task."),
      payload: event.metadata ?? {},
      projectId,
      source: "ultra.task",
      threadId,
    })
  } catch {
    // Persistence failure must not disrupt coordinator
  }
}
```

- [ ] **Step 3: Update all onEvent call sites to pass projectId**

Find every `onEvent: (event) => this.handleCoordinatorEvent(threadId, event)` call in the file and update to:

```typescript
onEvent: (event) => this.handleCoordinatorEvent(threadId, thread.projectId, event),
```

There are 3 call sites:
1. `startCoordinator` — line ~92
2. `sendMessage` primary path — line ~157
3. `sendMessage` resume fallback — line ~205

Search the file for `handleCoordinatorEvent` to find all call sites.

- [ ] **Step 4: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/backend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/threads/thread-turn-service.ts
git commit -m "feat: persist task events to thread_events table"
```

---

### Task 4: Create useThreadTasks hook

**Files:**
- Create: `apps/desktop/src/renderer/src/threads/hooks/useThreadTasks.ts`

- [ ] **Step 1: Create the hook**

```typescript
// apps/desktop/src/renderer/src/threads/hooks/useThreadTasks.ts
import { useMemo } from "react"
import type { ThreadTurnEventSnapshot } from "@ultra/shared"

export type TaskItem = {
  id: string
  description: string
  status: "pending" | "running" | "completed" | "failed" | "stopped"
  summary?: string
}

export type ThreadTasksState = {
  tasks: TaskItem[]
  percentage: number
  hasAnyTasks: boolean
  allComplete: boolean
  hasFailed: boolean
}

/**
 * Derives task checklist state from thread turn events.
 *
 * Handles:
 * - task_started → add/update task as "running"
 * - task_progress → update description/summary (creates synthetic entry if no prior started)
 * - task_notification → set terminal status
 * - Dedup by taskId (latest status wins)
 */
export function useThreadTasks(
  turnEvents: ThreadTurnEventSnapshot[],
  persistedTaskEvents?: Array<{ eventType: string; payload: Record<string, unknown> }>,
): ThreadTasksState {
  return useMemo(() => {
    const taskMap = new Map<string, TaskItem>()

    // First, load persisted events (from thread_events table on revisit)
    if (persistedTaskEvents) {
      for (const evt of persistedTaskEvents) {
        applyTaskEvent(taskMap, evt.eventType, evt.payload)
      }
    }

    // Then, apply live turn events (may overlap with persisted — dedup by taskId, latest wins)
    for (const event of turnEvents) {
      if (event.eventType !== "task_update") continue
      const payload = event.payload as { label?: string; metadata?: Record<string, unknown> }
      const label = payload.label
      const metadata = payload.metadata
      if (!label || !metadata) continue
      applyTaskEvent(taskMap, label, metadata)
    }

    const tasks = Array.from(taskMap.values())
    const terminalStatuses = new Set(["completed", "failed", "stopped"])
    const finishedCount = tasks.filter((t) => terminalStatuses.has(t.status)).length
    const percentage = tasks.length > 0 ? Math.round((finishedCount / tasks.length) * 100) : 0
    const allComplete = tasks.length > 0 && tasks.every((t) => terminalStatuses.has(t.status))
    const hasFailed = tasks.some((t) => t.status === "failed" || t.status === "stopped")

    return {
      tasks,
      percentage,
      hasAnyTasks: tasks.length > 0,
      allComplete,
      hasFailed,
    }
  }, [turnEvents, persistedTaskEvents])
}

function applyTaskEvent(
  taskMap: Map<string, TaskItem>,
  eventType: string,
  metadata: Record<string, unknown>,
): void {
  const taskId = metadata.taskId as string | undefined
  if (!taskId) return

  const existing = taskMap.get(taskId)

  if (eventType === "task_started" || eventType === "task.started") {
    taskMap.set(taskId, {
      id: taskId,
      description: (metadata.description as string) ?? existing?.description ?? "Task",
      status: "running",
      summary: existing?.summary,
    })
  } else if (eventType === "task_progress" || eventType === "task.progress") {
    taskMap.set(taskId, {
      id: taskId,
      description: (metadata.description as string) ?? existing?.description ?? "Task",
      status: existing?.status ?? "running",
      summary: (metadata.summary as string) ?? existing?.summary,
    })
  } else if (eventType === "task_notification" || eventType === "task.notification") {
    const status = metadata.status as string
    taskMap.set(taskId, {
      id: taskId,
      description: existing?.description ?? "Task",
      status: (status as TaskItem["status"]) ?? "completed",
      summary: (metadata.summary as string) ?? existing?.summary,
    })
  }
}
```

Note: The hook handles both live event type names (`task_started`) from turn events and persisted event type names (`task.started`) from thread_events. It also handles orphaned progress events by creating synthetic entries.

- [ ] **Step 2: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/hooks/useThreadTasks.ts
git commit -m "feat: add useThreadTasks hook for task checklist state"
```

---

### Task 5: Create ThreadTaskDrawer component

**Files:**
- Create: `apps/desktop/src/renderer/src/threads/ThreadTaskDrawer.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Create the drawer component**

```tsx
// apps/desktop/src/renderer/src/threads/ThreadTaskDrawer.tsx
import { useState, useEffect, useRef, useCallback } from "react"
import type { TaskItem } from "./hooks/useThreadTasks.js"

type Props = {
  tasks: TaskItem[]
  percentage: number
  allComplete: boolean
  hasFailed: boolean
}

const AUTO_DISMISS_MS = 60_000

function ChevronUp() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 6L8 2L13 6" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="14" height="7" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 2L8 6L13 2" />
    </svg>
  )
}

export function ThreadTaskDrawer({ tasks, percentage, allComplete, hasFailed }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      setDismissed(true)
    }, AUTO_DISMISS_MS)
  }, [clearTimer])

  // Auto-dismiss logic
  useEffect(() => {
    if (allComplete && !hasFailed && !expanded) {
      startTimer()
    } else {
      clearTimer()
    }
    return clearTimer
  }, [allComplete, hasFailed, expanded, startTimer, clearTimer])

  // Reset dismissed if new tasks appear (multi-run)
  useEffect(() => {
    if (!allComplete) {
      setDismissed(false)
    }
  }, [allComplete])

  if (dismissed || tasks.length === 0) return null

  const percentColor = hasFailed || percentage < 50 ? "#f0c674" : "#6ee7b7"

  if (!expanded) {
    return (
      <div
        className="task-drawer__lip"
        onClick={() => setExpanded(true)}
      >
        <ChevronUp />
        <span className="task-drawer__pct" style={{ color: percentColor }}>
          ({percentage}%)
        </span>
      </div>
    )
  }

  return (
    <div className="task-drawer__bar">
      <div
        className="task-drawer__header"
        onClick={() => setExpanded(false)}
      >
        <ChevronDown />
        <span className="task-drawer__pct" style={{ color: percentColor }}>
          ({percentage}%)
        </span>
      </div>
      <div className="task-drawer__list">
        {tasks.map((task) => (
          <div key={task.id} className={`task-drawer__item task-drawer__item--${task.status}`}>
            <span className="task-drawer__icon">
              {task.status === "completed" && "✓"}
              {task.status === "running" && "●"}
              {(task.status === "failed" || task.status === "stopped") && "✗"}
              {task.status === "pending" && "○"}
            </span>
            <span className="task-drawer__desc">{task.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add CSS styles**

In `apps/desktop/src/renderer/src/styles/app.css`, add after the existing thread input dock styles:

```css
/* ── Thread Task Drawer ──────────────────────────────────────────── */

.task-drawer__lip {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 3px 0;
  background: #1e2030;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  color: var(--text-muted);
  margin: 0 4px -6px;
  position: relative;
  z-index: 1;
}

.task-drawer__lip:hover {
  background: #232538;
}

.task-drawer__pct {
  font-size: 9px;
}

.task-drawer__bar {
  background: #1e2030;
  border-radius: 6px 6px 0 0;
  margin: 0 4px -6px;
  position: relative;
  z-index: 1;
}

.task-drawer__header {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  cursor: pointer;
  color: var(--text-muted);
}

.task-drawer__header:hover {
  color: var(--text-secondary);
}

.task-drawer__list {
  padding: 0 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 50vh;
  overflow-y: auto;
}

.task-drawer__item {
  display: flex;
  gap: 6px;
  padding: 2px 0;
  font-size: 10px;
}

.task-drawer__icon {
  flex-shrink: 0;
  width: 12px;
  text-align: center;
}

.task-drawer__desc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-drawer__item--completed {
  color: #6ee7b7;
}

.task-drawer__item--completed .task-drawer__desc {
  text-decoration: line-through;
  opacity: 0.5;
}

.task-drawer__item--running {
  color: #e0e4ee;
}

.task-drawer__item--running .task-drawer__icon {
  color: #f0c674;
  animation: pulse 1.5s infinite;
}

.task-drawer__item--running .task-drawer__desc {
  font-weight: 500;
}

.task-drawer__item--failed,
.task-drawer__item--stopped {
  color: #fb7185;
}

.task-drawer__item--pending {
  color: var(--text-muted);
}
```

Note: The `@keyframes pulse` animation already exists in app.css from the thread-input-dock styles. If not, add:
```css
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/ThreadTaskDrawer.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "feat: add ThreadTaskDrawer component with auto-dismiss"
```

---

### Task 6: Add fetchThreadTaskEvents workflow

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/thread-workflows.ts`

- [ ] **Step 1: Add fetchThreadTaskEvents function**

```typescript
export async function fetchThreadTaskEvents(
  threadId: string,
  client: WorkflowClient = ipcClient,
): Promise<Array<{ eventType: string; payload: Record<string, unknown> }>> {
  // Reuse existing fetchThreadEvents, then filter to task events client-side
  const events = await fetchThreadEvents(threadId, client)
  return events
    .filter((e) => e.eventType.startsWith("task."))
    .map((e) => ({
      eventType: e.eventType,
      payload: e.payload as Record<string, unknown>,
    }))
}
```

Note: `fetchThreadEvents` already exists in this file. The `payload` field is typed as `Record<string, unknown>` by the Zod schema — no defensive narrowing needed.

- [ ] **Step 2: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/thread-workflows.ts
git commit -m "feat: add fetchThreadTaskEvents for task history reconstruction"
```

---

### Task 7: Wire TaskDrawer into ThreadDetail and ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx`
- Modify: `apps/desktop/src/renderer/src/threads/ThreadPane.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

- [ ] **Step 1: Update ThreadDetail to render TaskDrawer**

Import and render `ThreadTaskDrawer` between `ThreadConversation` and `InputDock`. The drawer needs to be wrapped in a stacking container so it peeks above the input dock.

Add to ThreadDetail props:
```typescript
tasks: TaskItem[]
taskPercentage: number
tasksAllComplete: boolean
tasksHasFailed: boolean
```

Import:
```typescript
import { ThreadTaskDrawer } from "./ThreadTaskDrawer.js"
import type { TaskItem } from "./hooks/useThreadTasks.js"
```

Wrap the TaskDrawer + InputDock in a stacking div (same pattern as `chat-input-stack` in the main chat):

```tsx
<div className="thread-input-stack">
  {tasks.length > 0 && (
    <ThreadTaskDrawer
      tasks={tasks}
      percentage={taskPercentage}
      allComplete={tasksAllComplete}
      hasFailed={tasksHasFailed}
    />
  )}
  <InputDock ... />
</div>
```

Add CSS for `.thread-input-stack`:
```css
.thread-input-stack {
  position: relative;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Pass task props through ThreadPane**

Add to ThreadPane props:
```typescript
tasksByThreadId: Record<string, { tasks: TaskItem[]; percentage: number; allComplete: boolean; hasFailed: boolean }>
```

Pass to ThreadDetail:
```typescript
tasks={tasksByThreadId[selectedThread.id]?.tasks ?? []}
taskPercentage={tasksByThreadId[selectedThread.id]?.percentage ?? 0}
tasksAllComplete={tasksByThreadId[selectedThread.id]?.allComplete ?? false}
tasksHasFailed={tasksByThreadId[selectedThread.id]?.hasFailed ?? false}
```

- [ ] **Step 3: Wire in ChatPageShell**

1. Import:
```typescript
import { fetchThreadTaskEvents } from "../threads/thread-workflows.js"
import { useThreadTasks } from "../threads/hooks/useThreadTasks.js"
```

2. Add state for persisted task events:
```typescript
const [persistedTaskEvents, setPersistedTaskEvents] = useState<
  Array<{ eventType: string; payload: Record<string, unknown> }>
>([])
```

3. Fetch task events when thread is selected (in the existing `useEffect` for `selectedThreadId`):
```typescript
// Inside the existing selectedThreadId subscription useEffect, after subscriptions:
fetchThreadTaskEvents(threadId).then((events) => {
  if (!cancelled) setPersistedTaskEvents(events)
}).catch(() => {})
```

4. Call the hook:
```typescript
const threadTasks = useThreadTasks(threadTurnEvents, persistedTaskEvents)
```

5. Build the prop map and pass to ThreadPane:
```typescript
const tasksByThreadId = useMemo(() => {
  if (!selectedThreadId) return {}
  return { [selectedThreadId]: threadTasks }
}, [selectedThreadId, threadTasks])
```

Pass `tasksByThreadId` to `<ThreadPane>`.

- [ ] **Step 4: Verify build**

Run: `cd /Users/tony/Projects/ultra/apps/desktop && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/ThreadDetail.tsx apps/desktop/src/renderer/src/threads/ThreadPane.tsx apps/desktop/src/renderer/src/pages/ChatPageShell.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "feat: wire ThreadTaskDrawer into thread detail and page shell"
```

---

### Task 8: Update subagent-driven-development skill

**Files:**
- Modify: `vendor/superpowers/skills/subagent-driven-development/SKILL.md`

- [ ] **Step 1: Add completion checklist guidance**

Find the section that describes the final step after all tasks are complete (near the end of the process flow, around "Dispatch final code reviewer subagent"). Add after the final review step:

```markdown
**After all tasks are complete and final review passes:**

Output a final summary as a markdown checklist showing each task and its outcome. This serves as a permanent record in the conversation:

```markdown
## Implementation Complete

- [x] Task 1: DB migration — done
- [x] Task 2: Group definitions — done
- [x] Task 3: SSE event types — done
...
```
```

- [ ] **Step 2: Commit**

Note: This file is in a git submodule (`vendor/superpowers`). Commit inside the submodule first, then update the submodule ref in the parent:

```bash
cd /Users/tony/Projects/ultra/vendor/superpowers
git add skills/subagent-driven-development/SKILL.md
git commit -m "feat: add completion checklist output guidance"
cd /Users/tony/Projects/ultra
git add vendor/superpowers
git commit -m "chore: update superpowers submodule (completion checklist)"
```

---

### Task 9: Manual end-to-end verification

- [ ] **Step 1: Start the app**

- [ ] **Step 2: Promote a chat to thread and start coordinator**

The coordinator should use the subagent-driven-development skill with tasks.

- [ ] **Step 3: Verify task drawer appears**

1. Once the coordinator creates its first task, the drawer lip should appear above the input dock
2. The percentage should show in yellow (under 50%)
3. Click the lip to expand — verify checklist renders with correct status indicators

- [ ] **Step 4: Verify progress updates**

1. As tasks complete, the percentage should update
2. Completed items should show green checkmark with strikethrough
3. Active item should show pulsing yellow dot
4. At 50%, percentage color should change to green

- [ ] **Step 5: Verify auto-dismiss**

1. When all tasks complete, wait 60 seconds
2. The drawer should disappear
3. Expand the drawer before 60s — timer should pause
4. Collapse — timer should restart

- [ ] **Step 6: Verify persistence**

1. Navigate away from the thread
2. Navigate back
3. Task checklist should reconstruct from persisted events

- [ ] **Step 7: Commit any fixes**
