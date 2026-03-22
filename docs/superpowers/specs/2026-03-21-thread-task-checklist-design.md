# Thread Task Checklist — Design Spec

**Ticket:** ULR-TBD
**Date:** 2026-03-21
**Status:** Approved

## Goal

Surface the coordinator's task progress as a live checklist in the thread detail pane. The checklist appears as a collapsible drawer above the input dock (same pattern as the plan action bar in the main chat), showing real-time task completion progress with a percentage indicator.

## Data Source

The Claude Agent SDK streams three task-related message types during coordinator execution:

| SDK Message Type | Subtype | Payload |
|---|---|---|
| `system` | `task_started` | `{ task_id, description, task_type?, prompt? }` |
| `system` | `task_progress` | `{ task_id, description, summary?, last_tool_name?, usage }` |
| `system` | `task_notification` | `{ task_id, status: "completed"\|"failed"\|"stopped", summary, output_file, usage? }` |

Note: `output_file` from `task_notification` and `tool_use_id` from all three types are available but intentionally omitted from v1. Could enable "click to jump to output" in v2.

These messages are currently dropped by `mapSdkMessage()` in the Claude adapter. This feature captures them and pipes them through the existing event infrastructure.

## Data Flow

```
SDK stream → mapSdkMessage() → ChatRuntimeEvent("task_update")
  → ThreadTurnService.handleCoordinatorEvent()
    → ThreadTurnEvent emitted to listeners (live UI)
    → threadService.appendProjectedEvent() (persistence)
  → Frontend accumulates task state → renders TaskDrawer
```

No new subscriptions, IPC commands, or database tables required. Uses existing `threads.turn_events` subscription and `thread_events` table.

## Adapter Changes

Add three cases to `mapSdkMessage()` in `claude-chat-runtime-adapter.ts` for the `system` message type:

```typescript
case "system": {
  if (msg.subtype === "init" && msg.session_id) {
    vendorSessionId = msg.session_id
  }
  // Task lifecycle events
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

This requires adding `"task_update"` to the `ChatRuntimeEvent` union type:

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

## ThreadTurnService Changes

`handleCoordinatorEvent` already handles events with `label` + `metadata` (the `"label" in event` branch). The new `task_update` events have the same shape, so they flow through automatically to turn event listeners.

Additionally, persist task events to the `thread_events` table for history:

```typescript
if (event.type === "task_update") {
  this.threadService.appendProjectedEvent({
    projectId: thread.projectId,
    threadId,
    eventType: event.label.replace("task_", "task."),  // task_started → task.started
    actorType: "coordinator",
    source: "ultra.task",
    payload: event.metadata ?? {},
  })
}
```

This requires `handleCoordinatorEvent` to have access to `projectId`. The simplest approach: capture `projectId` in the closure where `onEvent` is defined (in `startCoordinator` and `sendMessage`), and pass it as a parameter:

```typescript
onEvent: (event) => this.handleCoordinatorEvent(threadId, thread.projectId, event),
```

Update the method signature to accept `projectId` as its second parameter. No new Map needed.

## Frontend: Task State Accumulation

### useThreadTasks Hook

A new hook that derives task state from thread turn events:

```typescript
type TaskItem = {
  id: string
  description: string
  status: "pending" | "running" | "completed" | "failed" | "stopped"
  summary?: string
}

type ThreadTasksState = {
  tasks: TaskItem[]
  percentage: number
  hasAnyTasks: boolean
  allComplete: boolean
}
```

Logic:
- `task_started` → add task with status `"running"`. If a `task_progress` arrived for this `task_id` before `task_started` (out-of-order/reconnect), merge the data.
- `task_progress` → update description/summary. If no matching `task_id` exists yet, create a synthetic entry with status `"running"`.
- `task_notification` → set final status (`"completed"`, `"failed"`, `"stopped"`)
- `percentage` = `Math.round((finishedCount / total) * 100)` where `finishedCount` includes `completed`, `failed`, and `stopped` tasks (all terminal states count toward progress)
- `hasAnyTasks` = `tasks.length > 0` (controls drawer visibility)
- `allComplete` = all tasks have terminal status

**Multi-run behavior:** If the user sends a follow-up message and the coordinator creates new tasks, they append to the existing list. Each task has a unique `task_id` from the SDK, so there's no collision. The percentage recalculates against the new total.

Events arrive via the existing `threads.turn_events` subscription — no new subscription needed.

### Persistence on Revisit

When the user navigates away and returns, `fetchThreadMessages` loads persisted messages, and the turn event subscription starts fresh. Task events persisted to `thread_events` need to be loaded to reconstruct checklist state.

Add a `fetchThreadTaskEvents` workflow that queries `threads.get_events` and filters client-side to `task.*` event types (the existing `getEvents` endpoint returns all events — no server-side filtering needed for v1). Call this alongside `fetchThreadMessages` when a thread is selected.

**Deduplication:** Task events loaded from the fetch are keyed by `task_id`. If the subscription delivers an event for a `task_id` already loaded, the hook merges (latest status wins) rather than duplicating.

## Frontend: TaskDrawer Component

### Placement

Rendered in `ThreadDetail` between `ThreadConversation` and `InputDock`, using the same stacking pattern as the plan action bar:
- Drawer at z-index 1, rounded top corners, background `#1e2030`
- InputDock at z-index 2, overlaps the drawer's bottom edge via negative margin

### Visibility

- **Hidden** when `hasAnyTasks === false` (no tasks created yet)
- **Visible** once the first `task_started` event arrives
- **Auto-dismiss** 60 seconds after `allComplete === true` (see dismiss behavior below)

### Collapsed State (Default)

A centered lip showing:
```
▲ (42%)
```
- Chevron in `--text-muted` color
- Percentage in yellow (`#f0c674`) when under 50%, green (`#6ee7b7`) at 50%+
- Click to expand

### Expanded State

Chevron flips to ▼, full task list drops down. Max height 50% of the thread pane with `overflow-y: auto` for scrolling when there are many tasks.

```
▼ (42%)
✓ DB migration          (green, strikethrough, dimmed)
✓ Group definitions     (green, strikethrough, dimmed)
✓ SSE event types       (green, strikethrough, dimmed)
✓ Coordinator update    (green, strikethrough, dimmed)
✓ Group runner          (green, strikethrough, dimmed)
● Frontend SSE handling (yellow dot pulsing, white text, bold)
○ ExpertsFanout wiring  (muted)
○ Badge rendering       (muted)
○ Thinking panel        (muted)
○ Integration tests     (muted)
○ Docs update           (muted)
○ Final review          (muted)
```

Status indicators:
- `✓` green — completed
- `●` yellow pulsing — currently running
- `✗` red — failed/stopped
- `○` muted — pending

### Auto-Dismiss at 100%

When all tasks reach a terminal status (`completed`, `failed`, `stopped`):

1. Start a 60-second timer
2. If the user expands the drawer during the timer, pause it
3. When the user re-collapses, restart the 60-second timer
4. After 60 seconds, the drawer disappears entirely (set `dismissed: true` in local state)
5. Dismissal is per-session only — revisiting the thread reconstructs from persisted events

### Failed Tasks

If any task fails, the percentage color stays yellow (not green) regardless of percentage, signaling that attention is needed. The drawer does NOT auto-dismiss if any task failed.

## Completion Message (Skill Change)

Add to `vendor/superpowers/skills/subagent-driven-development/SKILL.md`:

After the "Mark task complete in TodoWrite" step, add guidance:

> "When all tasks are complete, output a final summary as a markdown checklist showing each task and its outcome. This serves as a permanent record in the conversation."

This is a single line in the skill markdown. The coordinator LLM will format a markdown checklist naturally. The message gets persisted as a coordinator thread message (already implemented), providing a permanent record after the drawer auto-dismisses.

## Files

### New
- `apps/desktop/src/renderer/src/threads/ThreadTaskDrawer.tsx` — Collapsible drawer component (lip + expanded checklist)
- `apps/desktop/src/renderer/src/threads/hooks/useThreadTasks.ts` — Derives task state from turn events + persisted task events

### Modified
- `apps/backend/src/chats/runtime/types.ts` — Add `"task_update"` to `ChatRuntimeEvent` union
- `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` — Add `task_started`/`task_progress`/`task_notification` cases to `mapSdkMessage()`
- `apps/backend/src/threads/thread-turn-service.ts` — Persist task events to thread_events, store projectId for active threads
- `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx` — Render TaskDrawer between conversation and InputDock
- `apps/desktop/src/renderer/src/threads/thread-workflows.ts` — Add `fetchThreadTaskEvents` for reconstructing task state on revisit
- `apps/desktop/src/renderer/src/styles/app.css` — Task drawer styles
- `vendor/superpowers/skills/subagent-driven-development/SKILL.md` — Add completion checklist output guidance

### Unchanged
- `packages/shared/src/contracts/thread-turn-events.ts` — No schema changes (payload is `Record<string, unknown>`)
- `useThreadStreaming.ts` — Task events flow through existing pipeline, filtered by the new hook

## Out of Scope

- Clicking individual tasks to jump to their conversation context — v2
- Task duration/timing display — v2
- Reordering or manually editing tasks — not planned
- Task checklist in the main chat (only thread detail pane)
