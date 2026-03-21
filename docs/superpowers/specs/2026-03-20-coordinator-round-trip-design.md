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

**Missing (frontend):**
- No call to `ipcClient.subscribe("threads.messages", ...)` — messages only update on explicit fetch
- No streaming support for incremental coordinator responses
- All message types render identically (just `.content.text`)

## Design

### 1. Frontend Thread Message Subscription

Add `subscribeToThreadMessages()` to `thread-workflows.ts`. When a thread is selected in `ThreadPane`, call subscribe. On unmount or thread change, unsubscribe. Incoming messages are appended to the store's thread message list via existing `appendMessage` action.

On reconnect, replay from `from_sequence` to catch missed messages — same pattern as `chats.turn_events`.

### 2. Streaming Coordinator Responses

Coordinator responses stream as partial `thread_message_emitted` events. Multiple events can fire for the same `message_id` with incremental content.

Create a `useThreadStreaming` hook (following the same pattern as `useStreamingText` for chats) that:
- Tracks in-flight message IDs in component state
- Updates message content as new events arrive for the same `message_id`
- Marks as complete when `partial: false` or a new message starts
- Shows a typing/streaming indicator while a message is partial

### 3. Distinct Message Type Rendering

Each `messageType` gets visual treatment in `CoordinatorConversation`:

| Type | Rendering |
|------|-----------|
| `text` | Standard message bubble (user or coordinator) |
| `status` | Muted, italic system-style line (no bubble) |
| `blocking_question` | Highlighted card with attention indicator |
| `summary` | Collapsible section with header |
| `review_ready` | Success-styled card with action hint |
| `change_request_followup` | Warning-styled card referencing the change request |

### 4. Error Handling

- **Coordinator not running:** Inline message in conversation area — "Coordinator is not active for this thread"
- **Message delivery failure:** Inline error below input, re-enable input
- **Reconnect:** Auto-resubscribe with `from_sequence`, replay missed messages

### 5. Send Flow Enhancement

Enhance existing `sendThreadMessage` workflow:
- Disable input while sending (prevent double-send)
- Re-enable on success or failure
- Clear input on success

## Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/threads/thread-workflows.ts` | Add `subscribeToThreadMessages()` |
| `apps/desktop/src/renderer/src/threads/ThreadPane.tsx` | Subscribe on thread select, unsubscribe on change/unmount |
| `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx` | Wire subscription, enhance CoordinatorConversation with message types and streaming |
| `apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.ts` | New hook for streaming coordinator messages |
| `apps/desktop/src/renderer/src/threads/CoordinatorMessage.tsx` | New component for per-type message rendering |
| `apps/desktop/src/renderer/src/styles/app.css` | Styles for message types (status, blocking_question, summary, review_ready, change_request_followup) |
| `apps/desktop/src/renderer/src/state/app-store.ts` | Possibly add/update thread message actions if needed |

## Testing

- **useThreadStreaming hook:** Unit test — partial messages accumulate, complete on `partial: false`
- **subscribeToThreadMessages:** Unit test — subscription lifecycle, message appending
- **CoordinatorMessage:** Unit test — each message type renders with correct CSS class
- **Integration:** Manual test — send message in thread detail, see coordinator response stream back
- **Reconnect:** Manual test — disconnect/reconnect, verify missed messages replay
