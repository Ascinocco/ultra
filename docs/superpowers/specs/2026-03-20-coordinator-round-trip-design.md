# Coordinator Conversation Round-Trip & Streaming

**Date:** 2026-03-20
**Ticket:** ULR-84

## Problem

The thread detail UI has a CoordinatorConversation component with a message input, but it's a dead UI. When a user sends a message, it persists and dispatches to the coordinator, but coordinator responses never appear in real-time — the frontend doesn't subscribe to thread message events.

## Current State

**Fully working (backend):**
- `threads.send_message` IPC: router → ThreadService.sendMessage() → SQLite + coordinator NDJSON dispatch
- Coordinator receives messages via stdin NDJSON, responds with `thread_message_emitted` events
- Backend receives coordinator events, persists to `thread_messages`, notifies subscription listeners
- `threads.messages` subscription handler in socket server

**Missing (frontend + backend streaming):**
- No call to `ipcClient.subscribe("threads.messages", ...)` — messages only update on explicit fetch
- Backend emits complete messages only — no partial/streaming support in schema or emission
- All message types render identically (just `.content.text`)
- Store `appendMessage` has no deduplication — optimistic send + subscription would produce duplicates

## Design

### 1. Backend Streaming Support

The current `ThreadMessageSnapshot` schema has no `partial` field and the backend emits one complete event per message. To support streaming:

1. Add `partial?: boolean` to `threadMessageSnapshotSchema` in shared contracts
2. Update `ThreadService.notifyMessageListeners` to support emitting partial messages with the same `message_id`
3. Update `CoordinatorService.applyThreadMessage` to emit partial events when coordinator sends incremental content (the coordinator NDJSON protocol already supports multiple `thread_message_emitted` events for the same message_id)
4. Final emission sets `partial: false` (or omits the field) and persists the complete message to SQLite

Partial messages are NOT persisted — only the final complete message is written to `thread_messages`.

### 2. Frontend Thread Message Subscription

Add `subscribeToThreadMessages()` to `thread-workflows.ts`. Update the `WorkflowClient` type to include `subscribe` (matching `chat-message-workflows.ts` pattern).

Subscription lifecycle is managed via a `useThreadSubscription(threadId)` hook called from the parent container component — following existing patterns where ThreadPane is presentational and workflows are orchestrated by the parent.

On reconnect, refetch all messages via `threads.get_messages` query (defer `from_sequence` optimization to a future ticket).

### 3. Store Deduplication

Change the store's `appendMessage` to an `upsertMessage` pattern — check `message.id` before appending. If a message with the same ID exists, update its content (for streaming partial updates). If new, append. This prevents duplicates from optimistic send + subscription.

### 4. Streaming Display

Create a `useThreadStreaming` hook that:
- Receives messages from the subscription
- Tracks in-flight message IDs where `partial === true`
- Updates message content as new partial events arrive for the same `message_id`
- Marks as complete when `partial` is `false` or absent
- Shows a typing/streaming indicator while a message is partial

### 5. Distinct Message Type Rendering

Create a `CoordinatorMessage` component. Each `messageType` gets visual treatment:

| Type | Rendering |
|------|-----------|
| `text` | Standard message bubble (user or coordinator) |
| `status` | Muted, italic system-style line (no bubble) |
| `blocking_question` | Highlighted card with attention indicator |
| `summary` | Collapsible section with header |
| `review_ready` | Success-styled card with action hint |
| `change_request_followup` | Warning-styled card referencing the change request |

**Role-based rendering:** Messages with `system` role render as status lines regardless of `messageType`.

### 6. Error Handling

- **Coordinator not running:** Inline message in conversation area — "Coordinator is not active for this thread"
- **Message delivery failure:** Inline error below input, re-enable input
- **Reconnect:** Auto-resubscribe, refetch all messages via `threads.get_messages`

### 7. Send Flow Enhancement

The existing `sendThreadMessage` already clears input on submit (optimistic). Enhance to:
- Add a `sending` state to disable input during the IPC round-trip (prevent double-send)
- Re-enable on success or failure
- Show inline error on failure

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/src/contracts/threads.ts` | Add `partial?: boolean` to `threadMessageSnapshotSchema` |
| `apps/backend/src/threads/thread-service.ts` | Support partial message emission in `notifyMessageListeners` |
| `apps/backend/src/runtime/coordinator-service.ts` | Emit partial events for incremental coordinator content |
| `apps/desktop/src/renderer/src/threads/thread-workflows.ts` | Add `subscribeToThreadMessages()`, update `WorkflowClient` type to include `subscribe` |
| `apps/desktop/src/renderer/src/threads/hooks/useThreadSubscription.ts` | New hook for subscription lifecycle management |
| `apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.ts` | New hook for streaming partial messages |
| `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx` | Wire subscription via parent, enhance CoordinatorConversation |
| `apps/desktop/src/renderer/src/threads/ThreadPane.tsx` | Pass subscription props from parent |
| `apps/desktop/src/renderer/src/threads/CoordinatorMessage.tsx` | New component for per-type message rendering |
| `apps/desktop/src/renderer/src/styles/app.css` | Styles for message types |
| `apps/desktop/src/renderer/src/state/app-store.ts` | Change `appendMessage` to upsert pattern with dedup by ID |

## Testing

- **useThreadStreaming hook:** Unit test — partial messages accumulate, complete on `partial: false/absent`
- **subscribeToThreadMessages:** Unit test — subscription lifecycle, message upserting
- **CoordinatorMessage:** Unit test — each message type renders with correct CSS class, system role renders as status
- **Store dedup:** Unit test — upsert prevents duplicates, updates existing messages
- **Integration:** Manual test — send message in thread detail, see coordinator response stream back
- **Reconnect:** Manual test — disconnect/reconnect, verify messages refetch correctly
