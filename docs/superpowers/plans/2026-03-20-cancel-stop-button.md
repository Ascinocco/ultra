# Cancel/Stop Button & Enter-to-Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stop button to cancel running chat turns (killing the CLI subprocess), and make Enter submit messages.

**Architecture:** Thread an `AbortSignal` from `ChatTurnService` through the runtime adapter to the process runner. The process runner listens for abort and sends SIGTERM→SIGKILL to the child process. The frontend adds a Stop button that calls the existing `chats.cancel_turn` IPC command, and an `onKeyDown` handler for Enter-to-send.

**Tech Stack:** TypeScript, React, Node.js spawn (child_process), AbortController

**Spec:** `docs/superpowers/specs/2026-03-20-cancel-stop-button-design.md`

---

### Task 1: Add `signal` to `RuntimeProcessRunOptions` and `ChatRuntimeTurnRequest`

**Files:**
- Modify: `apps/backend/src/chats/runtime/types.ts:36-43` (RuntimeProcessRunOptions)
- Modify: `apps/backend/src/chats/runtime/types.ts:25-34` (ChatRuntimeTurnRequest)

- [ ] **Step 1: Add `signal` to `RuntimeProcessRunOptions`**

In `apps/backend/src/chats/runtime/types.ts`, add `signal` to `RuntimeProcessRunOptions`:

```typescript
export type RuntimeProcessRunOptions = {
  command: string
  args: string[]
  cwd: string
  stdin?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}
```

- [ ] **Step 2: Add `signal` to `ChatRuntimeTurnRequest`**

In the same file, add `signal` to `ChatRuntimeTurnRequest`:

```typescript
export type ChatRuntimeTurnRequest = {
  chatId: ChatId
  chatSessionId: string
  cwd: string
  prompt: string
  config: ChatRuntimeConfig
  continuationPrompt: string | null
  seedMessages: ChatMessageSnapshot[]
  vendorSessionId: string | null
  signal?: AbortSignal
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/chats/runtime/types.ts
git commit -m "feat(types): add AbortSignal to runtime process and turn request types"
```

---

### Task 2: Add AbortSignal support to process runner

**Files:**
- Modify: `apps/backend/src/chats/runtime/process-runner.ts`
- Create: `apps/backend/src/chats/runtime/process-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/chats/runtime/process-runner.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

import { SpawnRuntimeProcessRunner } from "./process-runner.js"

describe("SpawnRuntimeProcessRunner", () => {
  it("kills the child process when the abort signal fires", async () => {
    const controller = new AbortController()

    const runner = new SpawnRuntimeProcessRunner()
    const resultPromise = runner.run({
      command: "sleep",
      args: ["60"],
      cwd: "/tmp",
      signal: controller.signal,
    })

    // Give the process a moment to start
    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()

    const result = await resultPromise
    expect(result.signal).toBe("SIGTERM")
    expect(result.exitCode).toBeNull()
    expect(result.timedOut).toBe(false)
  })

  it("resolves normally when no signal is provided", async () => {
    const runner = new SpawnRuntimeProcessRunner()
    const result = await runner.run({
      command: "echo",
      args: ["hello"],
      cwd: "/tmp",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("hello")
    expect(result.signal).toBeNull()
  })

  it("escalates to SIGKILL if process ignores SIGTERM", async () => {
    const controller = new AbortController()

    const runner = new SpawnRuntimeProcessRunner()
    // Use a process that traps SIGTERM
    const resultPromise = runner.run({
      command: "bash",
      args: ["-c", 'trap "" TERM; sleep 60'],
      cwd: "/tmp",
      signal: controller.signal,
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()

    const result = await resultPromise
    // SIGKILL after 3s grace period
    expect(result.signal).toBe("SIGKILL")
    expect(result.exitCode).toBeNull()
  }, 10_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/backend/src/chats/runtime/process-runner.test.ts`
Expected: FAIL — first test times out or signal is not SIGTERM (no abort handling yet)

- [ ] **Step 3: Implement AbortSignal support in process runner**

In `apps/backend/src/chats/runtime/process-runner.ts`, add a `SIGKILL_GRACE_MS` constant and abort signal handling. After the timeout `setTimeout` block (line 39), add signal listener code:

Add constant at top:
```typescript
const SIGKILL_GRACE_MS = 3_000
```

Inside the `run` method, after the timeout setup and before stdout listeners, add:
```typescript
      let killEscalationTimeout: ReturnType<typeof setTimeout> | null = null

      if (options.signal) {
        const onAbort = () => {
          child.kill("SIGTERM")
          killEscalationTimeout = setTimeout(() => {
            child.kill("SIGKILL")
          }, SIGKILL_GRACE_MS)
        }

        if (options.signal.aborted) {
          onAbort()
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true })
        }
      }
```

In both the `error` and `close` handlers, clear the escalation timeout:
```typescript
        if (killEscalationTimeout) clearTimeout(killEscalationTimeout)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/backend/src/chats/runtime/process-runner.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/chats/runtime/process-runner.ts apps/backend/src/chats/runtime/process-runner.test.ts
git commit -m "feat(process-runner): add AbortSignal support with SIGTERM→SIGKILL escalation"
```

---

### Task 3: Forward signal through runtime adapters

**Files:**
- Modify: `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts`
- Modify: `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts`

- [ ] **Step 1: Update Claude adapter to forward signal**

In `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts`, in the `runTurn` method, add `signal: request.signal` to the `processRunner.run()` call:

```typescript
    const diagnostics = await this.processRunner.run({
      command: "claude",
      args,
      cwd: request.cwd,
      timeoutMs: FORTY_EIGHT_HOURS_MS,
      signal: request.signal,
    })
```

- [ ] **Step 2: Update Codex adapter to forward signal**

In `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts`, in the `runTurn` method, add `signal: request.signal`:

```typescript
    const diagnostics = await this.processRunner.run({
      command: "codex",
      args: buildArgs(request),
      cwd: request.cwd,
      signal: request.signal,
    })
```

- [ ] **Step 3: Run existing adapter tests to verify nothing broke**

Run: `npx vitest run apps/backend/src/chats/runtime/claude-chat-runtime-adapter.test.ts apps/backend/src/chats/runtime/codex-chat-runtime-adapter.test.ts`
Expected: PASS (all existing tests still pass — signal is optional)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts
git commit -m "feat(adapters): forward AbortSignal from turn request to process runner"
```

---

### Task 4: Wire AbortController in ChatTurnService

**Files:**
- Modify: `apps/backend/src/chats/chat-turn-service.ts`

- [ ] **Step 1: Add abort controller map as a class field**

Near the top of the `ChatTurnService` class (alongside other private fields), add:

```typescript
  private readonly turnAbortControllers = new Map<string, AbortController>()
```

- [ ] **Step 2: Create and pass AbortController in `executeClaimedTurn`**

In `executeClaimedTurn` (line ~895), create an `AbortController` before calling `runTurnWithRecovery`, store it in the map, and clean it up in the finally block:

```typescript
  private async executeClaimedTurn(
    chatId: ChatId,
    claimed: ClaimedTurn,
  ): Promise<void> {
    const runtimeContext = this.chatService.getRuntimeContext(chatId)
    const session = this.sessionManager.getSession(
      chatId,
      runtimeContext.chatSessionId,
      this.extractConfig(runtimeContext.chat),
      runtimeContext.rootPath,
    )
    const seedMessages = this.chatService.listMessages(chatId)

    const abortController = new AbortController()
    this.turnAbortControllers.set(claimed.turnId, abortController)

    try {
      const result = await this.runTurnWithRecovery(
        runtimeContext.chat,
        runtimeContext.rootPath,
        runtimeContext.chatSessionId,
        claimed.prompt,
        runtimeContext.continuationPrompt,
        seedMessages,
        session?.vendorSessionId ?? null,
        abortController.signal,
      )

      this.notifyTurnEvents(
        this.finalizeSucceededTurn({
          chatId,
          turnId: claimed.turnId,
          runtimeContext,
          result,
        }),
      )
    } catch (error) {
      this.notifyTurnEvents(this.finalizeFailedTurn(chatId, claimed.turnId, error))
    } finally {
      this.turnAbortControllers.delete(claimed.turnId)
    }
  }
```

- [ ] **Step 3: Thread signal through `runTurnWithRecovery`**

Update the `runTurnWithRecovery` method signature to accept a signal, and pass it in both `adapter.runTurn()` calls:

```typescript
  private async runTurnWithRecovery(
    chat: ReturnType<ChatService["get"]>,
    rootPath: string,
    chatSessionId: string,
    prompt: string,
    continuationPrompt: string | null,
    seedMessages: ChatMessageSnapshot[],
    vendorSessionId: string | null,
    signal?: AbortSignal,
  ) {
    const adapter = this.runtimeRegistry.get(chat.provider)

    try {
      return await adapter.runTurn({
        chatId: chat.id,
        chatSessionId,
        cwd: rootPath,
        prompt,
        config: this.extractConfig(chat),
        continuationPrompt,
        seedMessages,
        vendorSessionId,
        signal,
      })
    } catch (error) {
      if (!this.isRuntimeError(error) || error.kind !== "resume_failed") {
        throw error
      }

      this.sessionManager.invalidate(chat.id, chatSessionId)

      return adapter.runTurn({
        chatId: chat.id,
        chatSessionId,
        cwd: rootPath,
        prompt,
        config: this.extractConfig(chat),
        continuationPrompt,
        seedMessages,
        vendorSessionId: null,
        signal,
      })
    }
  }
```

- [ ] **Step 4: Call `abort()` in `cancelTurn` for running turns**

In the `cancelTurn` method (line ~313), after `this.notifyTurnEvents(eventsToNotify)` and before `return this.getTurn(...)`, add:

```typescript
    // Kill the running subprocess
    const controller = this.turnAbortControllers.get(turnId)
    if (controller) {
      controller.abort()
    }
```

- [ ] **Step 5: Run all backend chat tests**

Run: `npx vitest run apps/backend/src/chats/`
Expected: PASS (existing tests still pass — the abort controller is additive)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/chats/chat-turn-service.ts
git commit -m "feat(turn-service): wire AbortController to kill subprocess on cancel"
```

---

### Task 5: Add `cancelChatTurn` frontend workflow function

**Files:**
- Modify: `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts`

- [ ] **Step 1: Add `cancelChatTurn` workflow function**

Add after the `startChatTurn` function (around line 107):

```typescript
export async function cancelChatTurn(
  chatId: string,
  turnId: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("chats.cancel_turn", {
    chat_id: chatId,
    turn_id: turnId,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/chat-message-workflows.ts
git commit -m "feat(workflows): add cancelChatTurn workflow function"
```

---

### Task 6: Add Stop button and Enter-to-send to ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

- [ ] **Step 1: Import `cancelChatTurn`**

At the top of `ChatPageShell.tsx`, add `cancelChatTurn` to the import from `chat-message-workflows`:

```typescript
import {
  cancelChatTurn,
  // ... existing imports
} from "../chats/chat-message-workflows.js"
```

- [ ] **Step 2: Add `cancelRequested` state**

Near the other chat turn state (around line 407-412), add:

```typescript
const [cancelRequested, setCancelRequested] = useState(false)
```

And reset it when `inFlightTurn` changes to false. Add a `useEffect` near the other effects:

```typescript
useEffect(() => {
  if (!inFlightTurn) {
    setCancelRequested(false)
  }
}, [inFlightTurn])
```

- [ ] **Step 3: Add handleCancelTurn handler**

Near `handleStartTurn` (around line 803), add:

```typescript
function handleCancelTurn() {
  if (!activeChatId || !activeTurnId || cancelRequested) {
    return
  }

  setCancelRequested(true)
  void cancelChatTurn(activeChatId, activeTurnId).catch((err) => {
    console.error("[chat] failed to cancel turn:", err)
    setCancelRequested(false)
  })
}
```

- [ ] **Step 4: Add onKeyDown handler for Enter-to-send**

Near `handleStartTurn`, add:

```typescript
function handleChatInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !chatInputDisabled &&
    chatInput.trim().length > 0
  ) {
    event.preventDefault()
    const form = event.currentTarget.closest("form")
    if (form) {
      form.requestSubmit()
    }
  }
}
```

- [ ] **Step 5: Wire onKeyDown to textarea**

On the textarea element (line ~1083), add the `onKeyDown` prop:

```tsx
<textarea
  id="chat-input"
  className="active-chat-pane__input"
  rows={3}
  placeholder={
    inFlightTurn
      ? "Wait for the active turn to finish."
      : "Send a prompt to start a chat turn."
  }
  value={chatInput}
  onChange={(event) => setChatInput(event.target.value)}
  onKeyDown={handleChatInputKeyDown}
  disabled={chatInputDisabled}
/>
```

- [ ] **Step 6: Add Stop button above the Send button**

Replace the button area (lines ~1096-1108) with:

```tsx
<div className="active-chat-pane__button-stack">
  {inFlightTurn ? (
    <button
      className="active-chat-pane__stop"
      type="button"
      disabled={cancelRequested}
      onClick={handleCancelTurn}
    >
      {cancelRequested ? "Stopping…" : "Stop"}
    </button>
  ) : null}
  <button
    className="active-chat-pane__send"
    type="submit"
    disabled={
      chatInputDisabled || chatInput.trim().length === 0
    }
  >
    {chatTurnSendStatus === "starting"
      ? "Starting…"
      : inFlightTurn
        ? "Running…"
        : "Send"}
  </button>
</div>
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ChatPageShell.tsx
git commit -m "feat(ui): add Stop button and Enter-to-send in chat input"
```

---

### Task 7: Add basic CSS for the button stack and stop button

**Files:**
- Find and modify: the CSS file for `ChatPageShell` (search for `.active-chat-pane__send` to locate it)

- [ ] **Step 1: Find the CSS file**

Run: `grep -rl "active-chat-pane__send" apps/desktop/src/` to find the stylesheet.

- [ ] **Step 2: Add styles for the button stack and stop button**

Add these styles near the existing `.active-chat-pane__send` rules:

```css
.active-chat-pane__button-stack {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.active-chat-pane__stop {
  padding: 0.375rem 0.75rem;
  background: var(--color-danger, #e53e3e);
  color: #fff;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.active-chat-pane__stop:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Commit**

```bash
git add <css-file-path>
git commit -m "style: add Stop button and button stack styles"
```

---

### Task 8: Manual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` from the project root.

- [ ] **Step 2: Test Enter-to-send**

1. Open the app, navigate to a chat
2. Type a message in the textarea
3. Press Enter — message should submit
4. Type a message, press Shift+Enter — should insert a newline
5. Type more text, press Enter — should submit the full multi-line message

- [ ] **Step 3: Test the Stop button**

1. Send a message to start a turn
2. Verify the Stop button appears above the Send button
3. Click Stop — button should show "Stopping…" and disable
4. Verify the turn transitions to "Canceled" state
5. Verify the Stop button disappears once the turn is no longer in-flight

- [ ] **Step 4: Test edge cases**

1. Start a turn, wait for it to complete normally — Stop button should disappear
2. Start a turn, click Stop, then verify you can start a new turn afterward
