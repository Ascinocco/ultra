# ULR-19: Real-Time Chat Streaming

## Status

Design — approved, pending implementation.

## Objective

Stream assistant responses token-by-token in the chat transcript as they're generated, replacing the current batch-on-completion behavior. Requires both backend (streaming process runner) and frontend (streaming message display) changes.

## Context

The backend spawns Claude/Codex CLI as child processes via `process-runner.ts`. Currently stdout is buffered entirely until the process exits, then parsed into events and batch-emitted. The subscription infrastructure (`chats.turn_events`) and frontend store (`eventsByTurnId`) already support real-time delivery — the bottleneck is the process runner buffering.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Streaming process runner + event-driven frontend | Real end-to-end streaming; downstream infrastructure already supports it |
| Send path | Switch frontend to `chats.start_turn` (async) | `send_message` blocks until completion; `start_turn` returns immediately, enabling streaming |
| Streaming display | Temporary ChatMessage after real messages | Simplest approach; no store pollution, clean swap on completion |
| Markdown during streaming | Live rendering via MarkdownRenderer | Users expect formatted streaming; partial artifacts are widely accepted |
| Typing indicator | Pulsing dots before first delta | Immediate feedback that assistant is responding |
| Auto-scroll | Smart scroll — follows bottom unless user scrolled up | Standard chat-tail pattern; don't trap user at bottom during long responses |
| `send_message` | Keep unchanged | Still useful for programmatic/test use |

## Backend Changes

### 1. Streaming Process Runner

**File:** `apps/backend/src/chats/runtime/process-runner.ts`

**Current behavior:** Spawns child process, collects all stdout into a string, resolves promise on process exit.

**New behavior:** Attach a line-by-line listener to `child.stdout` (consider using `readline.createInterface` for built-in line buffering). As each complete line arrives, pass it to an `onLine` callback. The promise still resolves on process exit with the full `RuntimeProcessResult` (stdout, stderr, exit code, diagnostics — all unchanged). The `onLine` callback is **additive** — it streams lines during execution while the result still collects everything for the return value.

The API adds an optional `onLine` callback to the existing options:
```ts
// onLine is additive — RuntimeProcessResult stays unchanged
run(options: RuntimeProcessRunOptions & {
  onLine?: (line: string) => void
}): Promise<RuntimeProcessResult>
```

**Line buffering:** Stdout arrives as arbitrary chunks, not line-delimited. Buffer incoming data and split on `\n`. Only emit complete lines. Flush any remaining partial line on process close (malformed partial lines from crashes will be silently skipped by the JSON parser in the adapter).

**Performance note:** During streaming, each delta event triggers a database write via `appendTurnEventInternal` (INSERT + SELECT for sequence number). For responses with hundreds of deltas, this is a known cost. Acceptable for v1; batching deltas in the turn service (e.g., every 50ms) is a future optimization if latency becomes an issue.

### 2. Runtime Adapter Streaming

**Files:** `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts`, `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts`

**Current behavior:** `runTurn()` calls process runner, gets all stdout, parses all lines, returns `ChatRuntimeTurnResult` with all events collected.

**New behavior:** `runTurn()` receives an `onEvent` callback via the request object. As each stdout line arrives from the process runner's `onLine` callback, parse it immediately. If it produces a `ChatRuntimeEvent` (e.g., `assistant_delta`), call `onEvent(event)` right away. Also collect events for the final `ChatRuntimeTurnResult` return value (needed for the turn completion flow).

The `onEvent` callback is added to `ChatRuntimeTurnRequest` (keeping the single-object-argument pattern):
```ts
interface ChatRuntimeTurnRequest {
  // ... existing fields ...
  onEvent?: (event: ChatRuntimeEvent) => void  // new
}
```

The callback is optional for backward compatibility — `send_message` can continue using the batch path without passing it.

### 3. Turn Service Streaming Integration

**File:** `apps/backend/src/chats/chat-turn-service.ts`

When executing a turn via `chats.start_turn`, the turn service constructs an `onEvent` callback and includes it in the `ChatRuntimeTurnRequest`. The callback is threaded through `executeClaimedTurn` → `runTurnWithRecovery` → `adapter.runTurn`. On each event:

1. Map it via `mapRuntimeEventToTurnEvent`
2. Persist via `appendTurnEventInternal`
3. Notify subscribers via `notifyTurnEventListeners`

This replaces the batch `appendRuntimeEvents` call that currently happens in `finalizeSucceededTurn`.

The turn completion flow (`assistant_final` event) still triggers:
- Final assistant message creation via `chatService.appendMessage`
- Turn status update to "succeeded"
- `chat.turn_completed` event emission

**`send_message` path unchanged:** It still calls `runTurn` without the `onEvent` callback, gets the full result, and processes it synchronously.

## Frontend Changes

### 1. useStreamingText Hook

**File:** `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.ts`

```ts
function useStreamingText(
  activeTurnEvents: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,  // activeChatMessages.length — to detect final message arrival
): { streamingText: string | null; isStreaming: boolean }
```

**Logic:**
- When `inFlightTurn` is false AND the final assistant message is present in `activeChatMessages`: return `{ streamingText: null, isStreaming: false }`
- When `inFlightTurn` is false BUT no final message yet (race condition — turn status updated before message subscription delivered): keep showing `streamingText` until the message appears
- When `inFlightTurn` is true:
  - Filter `activeTurnEvents` for `eventType === "chat.turn_assistant_delta"`
  - Join their `payload.text` values into a single string
  - If no deltas yet: return `{ streamingText: "", isStreaming: true }` (signals typing indicator)
  - If deltas exist: return `{ streamingText: accumulated, isStreaming: true }`
- Wrap in `useMemo` keyed on `activeTurnEvents` and `inFlightTurn`

### 2. ChatMessage Streaming Support

**File:** `apps/desktop/src/renderer/src/chat-message/ChatMessage.tsx`

Add optional prop:

```ts
interface ChatMessageProps {
  role: "user" | "coordinator" | "assistant" | "system"
  content: string
  isStreaming?: boolean  // new
}
```

When `isStreaming` is true and content is empty, render a typing indicator (three pulsing dots) instead of message content. When `isStreaming` is true and content exists, render markdown normally — no other behavioral change.

**Important:** The current `ChatMessage` has an early return `if (!content.trim()) return null`. This guard must be bypassed when `isStreaming` is true, otherwise the typing indicator will never render.

**Typing indicator CSS:** Add a simple pulsing dots animation to `ChatMessage.css` using a `chat-message__typing` class.

### 3. useAutoScroll Hook

**File:** `apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.ts`

```ts
function useAutoScroll(
  scrollRef: RefObject<HTMLElement>,
  deps: unknown[],
): void
```

**Logic:**
- On each `deps` change, check if the scroll container is near the bottom (within 50px of `scrollHeight - scrollTop - clientHeight`)
- If near bottom: scroll to bottom via `scrollRef.current.scrollTo({ top: scrollHeight, behavior: "smooth" })`
- If user has scrolled up: do nothing
- Uses a `isNearBottom` check computed before the dependency update triggers the scroll

### 4. ChatPageShell Integration

**File:** `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

**Hook integration:**
```ts
const { streamingText, isStreaming } = useStreamingText(activeTurnEvents, inFlightTurn)
useAutoScroll(transcriptScrollRef, [activeChatMessages, streamingText])
```

**Streaming message rendering** (after the real messages in the transcript):
```tsx
{streamingText !== null && (
  <ChatMessage
    role="assistant"
    content={streamingText}
    isStreaming={isStreaming}
  />
)}
```

**Send path change:** Replace the current `startChatTurn` call (which uses `chats.send_message`) with `chats.start_turn`. The user's message is optimistically added to the transcript. The turn executes in the background; events stream via subscription.

**Scroll ref:** Add a `ref` to the transcript scroll container (`active-chat-pane__transcript-scroll`) for the auto-scroll hook.

### 5. Send Path Migration

**File:** `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts`

The `startChatTurn` function currently calls `chats.send_message` (synchronous). Change it to:

1. Call `chats.start_turn` (returns immediately with turn ID)
2. The turn events subscription (already active) handles streaming events
3. The messages subscription (already active) handles the final assistant message

The user's message is already optimistically inserted into the store by the existing workflow.

## Error Handling

**Turn failure during streaming:** If `chat.turn_failed` arrives, the streaming message shows accumulated text with a visual error indicator (e.g., muted styling + "Response interrupted" text). The streaming text stays visible since no final message will arrive.

**Reconnection mid-turn:** `chats.turn_events` subscription replays from last seen sequence number (existing `turnSequenceRef` mechanism). Deltas accumulate from replayed events.

**Batched deltas:** If deltas arrive all at once (fast response or degraded streaming), text appears at once — no special handling. The streaming message shows briefly, then gets swapped for the final message.

## Testing

**Backend:**
- Process runner: test that `onLine` callback fires for each line during execution, not after
- Runtime adapter: test that `onEvent` fires for each delta during `runTurn`
- Turn service: test that turn events are emitted incrementally during execution

**Frontend:**
- `useStreamingText`: unit tests for all states (no turn, turn with no deltas, turn with deltas, turn complete)
- `useAutoScroll`: test near-bottom detection and scroll-when-pinned behavior
- `ChatMessage`: test typing indicator renders when `isStreaming` and empty content
- Integration: verify streaming message appears during turn, disappears on completion

## File Summary

**Backend (modify):**
| File | Change |
|------|--------|
| `apps/backend/src/chats/runtime/process-runner.ts` | Stream stdout line-by-line via callback |
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` | Accept `onEvent` via request, parse + emit incrementally |
| `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts` | Same as Claude adapter |
| `apps/backend/src/chats/runtime/types.ts` | Add `onEvent` to `ChatRuntimeTurnRequest` |
| `apps/backend/src/chats/chat-turn-service.ts` | Thread `onEvent` through `executeClaimedTurn` → `runTurnWithRecovery` → adapter, emit turn events during execution |

**Frontend (create):**
| File | Purpose |
|------|---------|
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.ts` | Accumulate delta events into streaming text |
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.test.ts` | Unit tests |
| `apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.ts` | Smart scroll-to-bottom |
| `apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.test.ts` | Unit tests |

**Frontend (modify):**
| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/chat-message/ChatMessage.tsx` | Add `isStreaming` prop, typing indicator |
| `apps/desktop/src/renderer/src/chat-message/ChatMessage.css` | Typing indicator animation |
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Wire hooks, render streaming message, add scroll ref |
| `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts` | Switch send path from `send_message` to `start_turn` |

## Out of Scope

- Thread coordinator streaming (ULR-84 — separate domain flow)
- Turn cancellation UI (future ticket)
- Token count or speed display
- Streaming for `send_message` path (stays synchronous)

## References

- `docs/backend-ipc.md`
- `docs/wiring/chat-thread-wiring.md`
- `apps/backend/src/chats/runtime/process-runner.ts` (process runner)
- `apps/backend/src/chats/chat-turn-service.ts` (turn execution)
