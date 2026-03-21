# Promote to Thread — Design Spec

**Ticket:** ULR-105
**Date:** 2026-03-21
**Status:** Approved

## Goal

Replace the 3-step approval flow (plan → specs → start work) with a single "Promote to Thread" action that gathers chat planning context and creates a thread for autonomous execution.

## UX Surface

Three ways to promote:

1. **`/promote` command** — typed in the input dock, triggers promotion immediately
2. **`/plan` markers** — type `/plan` to open a planning section, `/plan` again to close it. Scopes which messages get sent as thread context. Optional.
3. **Promote drawer** — a subtle lip (up chevron) between the chat transcript and input dock. Click to expand a single row with "Promote to Thread" label, message count, and promote button. Only appears after 3+ messages.

### Promote Drawer States

**Collapsed:** Thin bar with centered up-chevron. Sits between transcript and input dock.

**Expanded:** Single tight row containing:
- Down-chevron (click to collapse)
- "Promote to Thread" label
- Message count badge (e.g. "12 messages")
- Purple "Promote" button

### `/plan` Markers

- `/plan` is intercepted by the frontend before sending — it is NOT sent to the LLM
- Odd occurrences are opens, even occurrences are closes (simple toggle)
- Open creates a `plan_marker_open` message, renders as `── PLANNING ──` divider
- Close creates a `plan_marker_close` message, renders as `── PLANNING COMPLETE ──` divider
- Markers scope which messages get bundled as thread context
- Nesting is not supported — each `/plan` simply toggles between open and closed

### `/promote` Command

- Intercepted by the frontend, NOT sent to the LLM
- Triggers the same promote flow as clicking the drawer button
- If the chat has fewer than 1 user message + 1 assistant message, show error toast: "Not enough context to promote"

## Context Gathering

`gatherPromoteContext(chatId, messages)` determines which message IDs to send:

1. **If `/plan` markers exist (matched open+close pair):** all message IDs between the most recent `plan_marker_open` and `plan_marker_close`
2. **If unclosed `/plan` marker:** all message IDs from the `plan_marker_open` to the end of the chat
3. **If no markers:** all message IDs since the last thread was created from this chat
4. **If no threads exist:** all message IDs in the chat

Returns an array of message IDs (not full snapshots — the backend looks them up from the database to avoid stale data).

## Thread Title

Auto-generated from the chat title: `"Thread: {chatTitle}"`. Can be renamed later via the existing inline rename flow (ULR-92).

## What Happens on Promote

1. Frontend calls `gatherPromoteContext()` to get message IDs
2. Frontend calls the new `chats.promote_to_thread` IPC command with `{ chat_id, title, context_message_ids }`
3. Backend looks up the messages by ID, creates a thread record linked to the parent chat
4. Backend stores context messages as `seed_context_json` on the thread record
5. Backend creates a `thread_start_request` message in the chat (for the divider)
6. Backend dispatches to coordinator (if wired — ULR-84)
7. Backend returns `ThreadDetailResult`
8. Frontend renders a "Thread created" divider in the chat transcript
9. Thread appears in the thread pane
10. Promote drawer collapses and becomes disabled for this context window

## Idempotency

- After a successful promote, the drawer disables the promote button (grayed out) until new messages are added to the chat
- `/promote` command similarly shows "Already promoted — add more context before promoting again" if no new messages exist since the last thread creation
- Backend checks: if a `thread_start_request` message already exists with no subsequent user messages, reject with a clear error

## Backend Changes

### New IPC command: `chats.promote_to_thread`

A new command that replaces the old `chats.start_thread` for the promote flow. The existing `chats.start_thread` and `chats.promote_work_to_thread` remain as-is for backwards compatibility but are effectively dead code.

```typescript
// New schema
chatsPromoteToThreadInputSchema = {
  chat_id: string
  title: string
  context_message_ids: string[]  // message IDs gathered by frontend
}
```

**Backend handler:**
1. Look up messages by IDs from the database
2. Create thread record with `seed_context_json` containing the message contents
3. Create a `thread_start_request` message in the chat
4. Dispatch to coordinator handler (if configured)
5. Return `ThreadDetailResult`

### New message types

- `plan_marker_open` — created when user types `/plan` (opening)
- `plan_marker_close` — created when user types `/plan` (closing)

These are `user` role messages with no content sent to the LLM. They serve as transcript markers only.

### `seed_context_json` on thread record

A new nullable TEXT column on the `threads` table storing the JSON-serialized context messages. The coordinator reads this when starting work. Migration required.

## Frontend Changes

### New Components

**`PromoteDrawer`**
- Sits between chat transcript and `InputDock`
- Collapsed: thin bar with up-chevron
- Expanded: single row with label, message count, promote button
- Only renders when chat has 3+ messages
- Disabled state after promote (until new messages arrive)
- On promote: calls workflow, collapses, divider appears

### Modified Components

**`InputDock`**
- Intercepts `/plan` and `/promote` before sending to LLM
- `/plan` → creates marker message via IPC, toggles plan state
- `/promote` → triggers promote flow (with minimum message guard)
- All other messages pass through normally

**`ChatPageShell`**
- Renders `<PromoteDrawer>` between transcript and input dock
- Renders plan marker dividers (`plan_marker_open`, `plan_marker_close`)
- Renders "Thread created" divider (existing `thread_start_request`)

### Removed Code

- `ApprovalBar` component and CSS
- `useApprovalState` hook
- `approvePlan`, `approveSpecs` workflow functions in `chat-message-workflows.ts`
- `handleApprovePlan`, `handleApproveSpecs`, `handleStartWork` handlers in ChatPageShell
- Related imports of `approvePlan`, `approveSpecs` from `chat-message-workflows.ts`

## Out of Scope

- Coordinator actually running and doing work (ULR-84)
- Bidirectional chat↔thread communication (ULR-104)
- Thread lifecycle buttons — approve, close, report back (ULR-104)
- Agent dispatch to worktrees (ULR-A1–A14)

## Key Files

### Frontend
- `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`
- `apps/desktop/src/renderer/src/chats/input-dock/InputDock.tsx`
- `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts`
- New: `apps/desktop/src/renderer/src/chats/promote-drawer/PromoteDrawer.tsx`

### Backend
- `apps/backend/src/ipc/router.ts`
- `apps/backend/src/chats/chat-service.ts`
- `apps/backend/src/threads/thread-service.ts`
- `packages/shared/src/contracts/chats.ts`
- `packages/shared/src/contracts/threads.ts`
- `apps/backend/src/db/migrations.ts` (new migration for `seed_context_json`)
