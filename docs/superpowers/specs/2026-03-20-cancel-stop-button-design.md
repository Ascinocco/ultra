# Cancel/Stop Button & Enter-to-Send

**Date:** 2026-03-20
**Ticket:** ULR-94

## Problem

When a chat turn is running, the user cannot cancel it. The Send button shows "Running..." but is not actionable. Additionally, Enter does not submit messages — users must click Send.

## Design

### Stop Button (Frontend)

A separate "Stop" button appears above the Send button only when `inFlightTurn` is true. Clicking it calls a new `cancelChatTurn` workflow function (added to `chat-message-workflows.ts`) which sends the `chats.cancel_turn` IPC command with the active chat ID and turn ID. The button disables immediately after click to prevent double-cancel. The Send button remains visible but disabled during a running turn (existing behavior).

**Location:** `ChatPageShell.tsx`, inside the form's button area (lines ~1096-1108), rendered conditionally above the existing Send button.

**State:** Uses existing `inFlightTurn`, `activeChatId`, and `activeTurnId` state. Adds a local `cancelRequested` boolean that resets when the turn completes or a new turn starts.

### Subprocess Kill (Backend)

The existing `cancelTurn()` in `ChatTurnService` flags `cancel_requested_at` in the database but does not terminate the running Claude CLI process. We need to:

1. **Add `AbortSignal` support to the process runner.** `SpawnRuntimeProcessRunner.run()` accepts an optional `AbortSignal` via `RuntimeProcessRunOptions`. When the signal fires, the child process is killed with SIGTERM, followed by SIGKILL after a 3-second grace period if the process hasn't exited.

2. **Wire the abort signal through the runtime adapter interface.** Add `signal?: AbortSignal` to `ChatRuntimeTurnRequest` in the shared types. Both `ClaudeChatRuntimeAdapter.runTurn()` and `CodexChatRuntimeAdapter.runTurn()` forward the signal to `processRunner.run()`.

3. **Create and store abort controllers per turn.** `ChatTurnService` creates an `AbortController` when a turn starts running (in `executeClaimedTurn`, before calling `runTurnWithRecovery`), stores it in a `Map<TurnId, AbortController>`, and calls `controller.abort()` when `cancelTurn()` is invoked for a running turn. The same signal is used across retries within `runTurnWithRecovery`. The controller is cleaned up when the turn finalizes (success, failure, or cancel). If `cancelTurn` is called for a turn whose controller is missing (e.g. after a backend restart), it proceeds gracefully — the turn will be recovered by `failStaleRunningTurns()`.

4. **Existing finalization handles the rest.** When the process is killed, it exits with a non-zero code/signal. The adapter may return partial text if some output was captured before termination — this is expected. The existing `finalizeSucceededTurn` checks `cancelRequestedAt` and routes to `finalizeCanceledRunningTurn()`, which discards the partial result and transitions the turn to `canceled`.

### Enter-to-Send (Frontend)

Add an `onKeyDown` handler on the chat textarea:

- **Enter** (no modifier): Prevent default, call `handleStartTurn()` if input is non-empty and not disabled.
- **Shift+Enter**: Allow default behavior (newline insertion).
- **Cmd+Enter / Ctrl+Enter**: Also sends (common chat app convention).

**Location:** `ChatPageShell.tsx`, on the textarea element (line ~1083).

## Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Add Stop button, `cancelRequested` state, `onKeyDown` handler |
| `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts` | Add `cancelChatTurn` workflow function |
| `apps/backend/src/chats/runtime/process-runner.ts` | Add `AbortSignal` support to `run()` with SIGTERM→SIGKILL escalation |
| `apps/backend/src/chats/runtime/types.ts` | Add `signal?: AbortSignal` to `RuntimeProcessRunOptions` and `ChatRuntimeTurnRequest` |
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` | Forward signal to process runner |
| `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts` | Forward signal to process runner |
| `apps/backend/src/chats/chat-turn-service.ts` | Create/store/invoke `AbortController` per running turn in `executeClaimedTurn` |

## Testing

- **Process runner:** Unit test that abort signal kills the child process
- **Adapter:** Unit test that signal is forwarded
- **Turn service:** Verify cancel of running turn aborts the controller; verify missing controller is handled gracefully
- **Frontend:** Manual test — start a turn, click Stop, verify turn transitions to canceled
- **Enter-to-send:** Manual test — Enter submits, Shift+Enter adds newline, Cmd+Enter sends
