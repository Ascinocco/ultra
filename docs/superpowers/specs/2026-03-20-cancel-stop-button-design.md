# Cancel/Stop Button & Enter-to-Send

**Date:** 2026-03-20
**Ticket:** ULR-94

## Problem

When a chat turn is running, the user cannot cancel it. The Send button shows "Running..." but is not actionable. Additionally, Enter does not submit messages — users must click Send.

## Design

### Stop Button (Frontend)

A separate "Stop" button appears above the Send button only when `inFlightTurn` is true. Clicking it calls the existing `chats.cancel_turn` IPC command with the active chat ID and turn ID. The button disables immediately after click to prevent double-cancel. The Send button remains visible but disabled during a running turn (existing behavior).

**Location:** `ChatPageShell.tsx`, inside the form's button area (lines ~1096-1108), rendered conditionally above the existing Send button.

**State:** Uses existing `inFlightTurn`, `activeChatId`, and `activeTurnId` state. Adds a local `cancelRequested` boolean that resets when the turn completes or a new turn starts.

### Subprocess Kill (Backend)

The existing `cancelTurn()` in `ChatTurnService` flags `cancel_requested_at` in the database but does not terminate the running Claude CLI process. We need to:

1. **Add an `AbortController`-style mechanism to the process runner.** `SpawnRuntimeProcessRunner.run()` accepts an optional `AbortSignal`. When the signal fires, the child process is killed (SIGTERM).

2. **Wire the abort signal through the runtime adapter.** `ClaudeChatRuntimeAdapter.runTurn()` accepts an optional `AbortSignal` and passes it to `processRunner.run()`.

3. **Create and store abort controllers per turn.** `ChatTurnService` creates an `AbortController` when a turn starts running, stores it in a `Map<TurnId, AbortController>`, and calls `controller.abort()` when `cancelTurn()` is invoked for a running turn. The controller is cleaned up when the turn finalizes (success, failure, or cancel).

4. **Existing finalization handles the rest.** When the process is killed, it exits with a non-zero code/signal. The existing `finalizeCanceledRunningTurn()` path handles the DB transition and event emission.

### Enter-to-Send (Frontend)

Add an `onKeyDown` handler on the chat textarea:

- **Enter** (no modifier): Prevent default, call `handleStartTurn()` if input is non-empty and not disabled.
- **Shift+Enter**: Allow default behavior (newline insertion).

**Location:** `ChatPageShell.tsx`, on the textarea element (line ~1083).

## Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Add Stop button, `cancelRequested` state, `onKeyDown` handler |
| `apps/backend/src/chats/runtime/process-runner.ts` | Add `AbortSignal` support to `run()` |
| `apps/backend/src/chats/runtime/types.ts` | Add `signal?: AbortSignal` to `RuntimeProcessRunOptions` |
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` | Pass signal through to process runner |
| `apps/backend/src/chats/chat-turn-service.ts` | Create/store/invoke `AbortController` per running turn |

## Testing

- **Process runner:** Unit test that abort signal kills the child process
- **Adapter:** Unit test that signal is forwarded
- **Turn service:** Verify cancel of running turn aborts the controller
- **Frontend:** Manual test — start a turn, click Stop, verify turn transitions to canceled
- **Enter-to-send:** Manual test — Enter submits, Shift+Enter adds newline
