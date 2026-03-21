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
- First `/plan` creates a `plan_marker_open` message, renders as `── PLANNING ──` divider
- Second `/plan` creates a `plan_marker_close` message, renders as `── PLANNING COMPLETE ──` divider
- Markers scope which messages get bundled as thread context

### `/promote` Command

- Intercepted by the frontend, NOT sent to the LLM
- Triggers the same promote flow as clicking the drawer button

## Context Gathering

`gatherPromoteContext(chatId, messages)` determines which messages to send:

1. **If `/plan` markers exist:** all messages between the most recent `plan_marker_open` and `plan_marker_close`
2. **If no markers:** all messages since the last thread was created from this chat
3. **If no threads exist:** all messages in the chat

Context messages are sent as seed input to the thread coordinator LLM.

## What Happens on Promote

1. Frontend calls `chats.start_thread` with simplified params: `{ chat_id, title, context_messages, summary? }`
2. Backend creates a thread record linked to the parent chat
3. Context messages are stored as the coordinator's seed prompt
4. Backend dispatches to coordinator (if wired — ULR-84)
5. Backend returns `ThreadDetailResult`
6. Frontend renders a "Thread created" divider in the chat transcript
7. Thread appears in the thread pane
8. Promote drawer collapses

## Backend Changes

### Simplified `chats.start_thread` input

Drop the mandatory `planApprovalMessageId` / `specApprovalMessageId` requirements. New input:

```typescript
{
  chat_id: string
  title: string
  context_messages: ChatMessageSnapshot[]  // gathered by frontend
  summary?: string | null
}
```

The old 3-step approval validation (plan → specs → start) is bypassed.

### New message types

- `plan_marker_open` — created when user types `/plan` (opening)
- `plan_marker_close` — created when user types `/plan` (closing)

These are `user` role messages with no content sent to the LLM. They serve as transcript markers only.

## Frontend Changes

### New Components

**`PromoteDrawer`**
- Sits between chat transcript and `InputDock`
- Collapsed: thin bar with up-chevron
- Expanded: single row with label, message count, promote button
- Only renders when chat has 3+ messages
- On promote: calls workflow, collapses, divider appears

### Modified Components

**`InputDock`**
- Intercepts `/plan` and `/promote` before sending to LLM
- `/plan` → creates marker message via IPC, toggles plan state
- `/promote` → triggers promote flow
- All other messages pass through normally

**`ChatPageShell`**
- Renders `<PromoteDrawer>` between transcript and input dock
- Renders plan marker dividers (`plan_marker_open`, `plan_marker_close`)
- Renders "Thread created" divider (existing `thread_start_request`)

### Removed Code

- `ApprovalBar` component and CSS
- `useApprovalState` hook
- `approvePlan`, `approveSpecs` workflow functions
- `handleApprovePlan`, `handleApproveSpecs`, `handleStartWork` handlers in ChatPageShell

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
