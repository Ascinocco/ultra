# ULR-19: Real-Time Chat Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream assistant responses token-by-token in the chat transcript as they're generated, replacing the current batch-on-completion display.

**Architecture:** Refactor the backend process runner to stream stdout line-by-line via callback during execution (instead of buffering). Runtime adapters parse lines incrementally and emit events in real-time. The turn service persists and notifies each event as it arrives. The frontend accumulates delta events into a streaming ChatMessage that displays with live markdown rendering and smart auto-scroll.

**Tech Stack:** Node.js child_process streams, readline, TypeScript, React, Vitest, Zustand

**Spec:** `docs/superpowers/specs/2026-03-19-chat-streaming-design.md`

**Worktree:** `.claude/worktrees/ulr-19-chat-streaming/` (branch: `feat/ulr-19-chat-streaming`)

**Important discovery:** The frontend already uses `chats.start_turn` (async path), NOT `chats.send_message`. No send path migration is needed on the frontend.

---

## File Structure

**Backend (modify):**

| File | Responsibility |
|------|---------------|
| `apps/backend/src/chats/runtime/types.ts` | Add `onEvent` to `ChatRuntimeTurnRequest` |
| `apps/backend/src/chats/runtime/process-runner.ts` | Stream stdout lines via `onLine` callback |
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` | Parse lines incrementally, call `onEvent` per event |
| `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts` | Same as Claude adapter |
| `apps/backend/src/chats/chat-turn-service.ts` | Thread `onEvent` through execution chain, emit events during turn |

**Frontend (create):**

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.ts` | Accumulate delta events into streaming text |
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.test.ts` | Unit tests |
| `apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.ts` | Smart scroll-to-bottom |
| `apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.test.ts` | Unit tests |

**Frontend (modify):**

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/renderer/src/chat-message/ChatMessage.tsx` | Add `isStreaming` prop, typing indicator |
| `apps/desktop/src/renderer/src/chat-message/ChatMessage.css` | Typing indicator animation |
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Wire hooks, render streaming message, add scroll ref |

---

### Task 1: Add `onEvent` to Runtime Types

**Files:**
- Modify: `apps/backend/src/chats/runtime/types.ts:25-35` (ChatRuntimeTurnRequest)

- [ ] **Step 1: Add `onEvent` field to `ChatRuntimeTurnRequest`**

In `apps/backend/src/chats/runtime/types.ts`, add the optional `onEvent` callback to the type at line 35 (before the closing brace):

```ts
// Add to ChatRuntimeTurnRequest (after signal?: AbortSignal)
  onEvent?: (event: ChatRuntimeEvent) => void
```

The full type becomes:
```ts
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
  onEvent?: (event: ChatRuntimeEvent) => void
}
```

- [ ] **Step 2: Verify the project compiles**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors (the field is optional, so no consumers break)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/chats/runtime/types.ts
git commit -m "feat(ulr-19): add onEvent callback to ChatRuntimeTurnRequest"
```

---

### Task 2: Streaming Process Runner

**Files:**
- Modify: `apps/backend/src/chats/runtime/process-runner.ts:20-99`
- Modify: `apps/backend/src/chats/runtime/types.ts:37-45` (RuntimeProcessRunOptions)
- Create: `apps/backend/src/chats/runtime/process-runner.test.ts`

- [ ] **Step 1: Add `onLine` to `RuntimeProcessRunOptions`**

In `types.ts`, add the optional callback to `RuntimeProcessRunOptions`:

```ts
export type RuntimeProcessRunOptions = {
  command: string
  args: string[]
  cwd: string
  stdin?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  onLine?: (line: string) => void  // new: called for each stdout line during execution
}
```

- [ ] **Step 2: Write failing test for streaming behavior**

```ts
// process-runner.test.ts
import { describe, expect, it, vi } from "vitest"
import { SpawnRuntimeProcessRunner } from "./process-runner.js"

describe("SpawnRuntimeProcessRunner", () => {
  it("calls onLine for each stdout line during execution", async () => {
    const lines: string[] = []
    const runner = new SpawnRuntimeProcessRunner()

    const result = await runner.run({
      command: "printf",
      args: ["line1\\nline2\\nline3\\n"],
      cwd: "/tmp",
      onLine: (line) => lines.push(line),
    })

    expect(lines).toEqual(["line1", "line2", "line3"])
    expect(result.exitCode).toBe(0)
    // stdout is still collected for diagnostics
    expect(result.stdoutLines).toContain("line1")
  })

  it("still works without onLine callback", async () => {
    const runner = new SpawnRuntimeProcessRunner()

    const result = await runner.run({
      command: "echo",
      args: ["hello"],
      cwd: "/tmp",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdoutLines).toContain("hello")
  })

  it("handles partial lines across chunks", async () => {
    const lines: string[] = []
    const runner = new SpawnRuntimeProcessRunner()

    // Use printf to emit a single line (no trailing newline = partial line flushed on close)
    const result = await runner.run({
      command: "printf",
      args: ["partial"],
      cwd: "/tmp",
      onLine: (line) => lines.push(line),
    })

    expect(lines).toEqual(["partial"])
    expect(result.exitCode).toBe(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/chats/runtime/process-runner.test.ts`
Expected: FAIL — `onLine` not called (lines array empty in first test)

- [ ] **Step 4: Implement streaming in process runner**

In `process-runner.ts`, modify the `run` method. Replace the stdout data handler (lines 59-61) with a `readline`-based line streamer that both calls `onLine` and collects stdout:

```ts
import { createInterface } from "node:readline"

// Inside the run method, replace:
//   child.stdout.on("data", (chunk) => { stdout += chunk.toString() })
// with:

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString()
})

if (options.onLine) {
  const rl = createInterface({ input: child.stdout })
  rl.on("line", (line) => {
    options.onLine!(line)
  })
}
```

**Important:** The `readline` interface consumes the same stream as the `data` handler. Since `data` is attached first and `readline` uses its own buffering, both work. However, to be safe, use a simpler approach — manually buffer and split in the `data` handler:

```ts
let lineBuffer = ""

child.stdout.on("data", (chunk) => {
  const text = chunk.toString()
  stdout += text

  if (options.onLine) {
    lineBuffer += text
    const parts = lineBuffer.split("\n")
    // Last element is incomplete (no trailing \n yet) — keep it in buffer
    lineBuffer = parts.pop()!
    for (const part of parts) {
      if (part.length > 0) {
        options.onLine(part)
      }
    }
  }
})
```

Then in the `close` handler (before resolving), flush any remaining buffer:

```ts
// Inside the close handler, before resolve():
if (options.onLine && lineBuffer.length > 0) {
  options.onLine(lineBuffer)
  lineBuffer = ""
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/chats/runtime/process-runner.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/chats/runtime/process-runner.ts apps/backend/src/chats/runtime/process-runner.test.ts apps/backend/src/chats/runtime/types.ts
git commit -m "feat(ulr-19): stream stdout lines via onLine callback in process runner"
```

---

### Task 3: Incremental Event Emission in Claude Adapter

**Files:**
- Modify: `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts:143-236`

- [ ] **Step 1: Write failing test**

Create `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { ClaudeChatRuntimeAdapter } from "./claude-chat-runtime-adapter.js"
import type { ChatRuntimeEvent, RuntimeProcessRunner, RuntimeProcessRunOptions, RuntimeProcessResult } from "./types.js"

function makeFakeRunner(lines: string[]): RuntimeProcessRunner {
  return {
    run: async (options: RuntimeProcessRunOptions): Promise<RuntimeProcessResult> => {
      // Simulate streaming by calling onLine for each line
      if (options.onLine) {
        for (const line of lines) {
          options.onLine(line)
        }
      }
      return {
        exitCode: 0,
        signal: null,
        stdout: lines.join("\n"),
        stderr: "",
        stdoutLines: lines,
        stderrLines: [],
        timedOut: false,
      }
    },
  }
}

describe("ClaudeChatRuntimeAdapter streaming", () => {
  it("calls onEvent for each delta during runTurn", async () => {
    const events: ChatRuntimeEvent[] = []
    // NOTE: Verify these match the actual Claude --output-format stream-json output.
    // Claude may wrap events in {"type":"stream_event","event":{...}} — check
    // parseClaudeLines for the expected format and adjust test data accordingly.
    const lines = [
      '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      '{"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
      '{"type":"message","content":[{"type":"text","text":"Hello world"}]}',
    ]

    const adapter = new ClaudeChatRuntimeAdapter(makeFakeRunner(lines))
    const result = await adapter.runTurn({
      chatId: "chat_1" as any,
      chatSessionId: "sess_1",
      cwd: "/tmp",
      prompt: "test",
      config: { provider: "claude", model: "claude-sonnet-4-6", thinkingLevel: "normal", permissionLevel: "supervised" },
      continuationPrompt: null,
      seedMessages: [],
      vendorSessionId: null,
      onEvent: (event) => events.push(event),
    })

    // onEvent should have been called for each delta as it arrived
    const deltas = events.filter((e) => e.type === "assistant_delta")
    expect(deltas.length).toBeGreaterThanOrEqual(2)
    expect(deltas[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(deltas[1]).toEqual({ type: "assistant_delta", text: " world" })

    // Final result still contains all events
    expect(result.events.length).toBeGreaterThan(0)
    expect(result.finalText).toBe("Hello world")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/chats/runtime/claude-chat-runtime-adapter.test.ts`
Expected: FAIL — `onEvent` not called (events array empty)

- [ ] **Step 3: Implement incremental parsing in Claude adapter**

In the `runTurn` method of `ClaudeChatRuntimeAdapter`, modify the process runner call to pass an `onLine` callback that parses each line and calls `request.onEvent`:

```ts
// Replace the current process runner call (lines 156-162) with:
const incrementalEvents: ChatRuntimeEvent[] = []

const diagnostics = await this.processRunner.run({
  command: "claude",
  args,
  cwd: request.cwd,
  timeoutMs: FORTY_EIGHT_HOURS_MS,
  signal: request.signal,
  onLine: request.onEvent
    ? (line) => {
        const lineEvents = parseClaudeLine(line)
        for (const event of lineEvents) {
          incrementalEvents.push(event)
          request.onEvent!(event)
        }
      }
    : undefined,
})
```

This requires extracting a `parseClaudeLine(line: string): ChatRuntimeEvent[]` function from the existing `parseClaudeLines`. The new function parses a single line and returns any events it produces. The existing `parseClaudeLines` can be reimplemented in terms of it.

**Extract `parseClaudeLine` from `parseClaudeLines`:**

```ts
// New single-line parser
function parseClaudeLine(line: string): ChatRuntimeEvent[] {
  const events: ChatRuntimeEvent[] = []
  const trimmed = line.trim()
  if (!trimmed) return events

  let json: any
  try {
    json = JSON.parse(trimmed)
  } catch {
    return events
  }

  // ... same parsing logic from parseClaudeLines, but for one line
  // Push events to the array instead of the outer scope
  return events
}
```

Then the existing batch path still works — `parseClaudeLines(lines)` iterates over lines calling `parseClaudeLine(line)` for each.

When `onEvent` is provided, the adapter uses `incrementalEvents` (populated during streaming) instead of re-parsing from `diagnostics.stdoutLines`. The final result is built from the same events either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run src/chats/runtime/claude-chat-runtime-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing backend tests to verify nothing broke**

Run: `cd apps/backend && npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts apps/backend/src/chats/runtime/claude-chat-runtime-adapter.test.ts
git commit -m "feat(ulr-19): incremental event emission in Claude adapter"
```

---

### Task 4: Incremental Event Emission in Codex Adapter

**Files:**
- Modify: `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts:140-187`

Same pattern as Task 3 but for the Codex adapter. Extract `parseCodexLine` from `parseCodexLines`. Wire `onLine` → `parseCodexLine` → `request.onEvent` in `runTurn`.

- [ ] **Step 1: Write failing test**

Create `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.test.ts` with the same structure as the Claude test but using Codex-format JSON lines.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/chats/runtime/codex-chat-runtime-adapter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement incremental parsing (same pattern as Claude)**

Extract `parseCodexLine`, wire `onLine` → `parseCodexLine` → `request.onEvent`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run src/chats/runtime/codex-chat-runtime-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts apps/backend/src/chats/runtime/codex-chat-runtime-adapter.test.ts
git commit -m "feat(ulr-19): incremental event emission in Codex adapter"
```

---

### Task 5: Thread `onEvent` Through Turn Service

**Files:**
- Modify: `apps/backend/src/chats/chat-turn-service.ts`
  - `runTurnWithRecovery` (lines 1639-1682)
  - `executeClaimedTurn` (lines 903-944)
  - `finalizeSucceededTurn` usage of `appendRuntimeEvents`

- [ ] **Step 1: Add `onEvent` parameter to `runTurnWithRecovery`**

Add an optional `onEvent` parameter that gets included in the `ChatRuntimeTurnRequest`:

```ts
private async runTurnWithRecovery(
  chat: ReturnType<ChatService["get"]>,
  rootPath: string,
  chatSessionId: string,
  prompt: string,
  continuationPrompt: string | null,
  seedMessages: ChatMessageSnapshot[],
  vendorSessionId: string | null,
  signal?: AbortSignal,
  onEvent?: (event: ChatRuntimeEvent) => void,  // new
)
```

In **both** adapter calls in `runTurnWithRecovery` — the initial call (line 1656) AND the retry call (line 1670 for `resume_failed`) — add `onEvent` to the request object:

```ts
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
  onEvent,  // new
})
```

- [ ] **Step 2: Build the streaming `onEvent` callback in `executeClaimedTurn`**

In `executeClaimedTurn`, construct a callback that persists and notifies each event as it arrives:

```ts
const timestamp = new Date().toISOString()
const streamingOnEvent = (runtimeEvent: ChatRuntimeEvent) => {
  const mapped = this.mapRuntimeEventToTurnEvent(runtimeEvent)
  const persisted = this.appendTurnEventInternal({
    chatId,
    turnId: claimed.turnId,
    eventType: mapped.eventType,
    source: "runtime",
    actorType: "assistant",
    actorId: null,
    payload: mapped.payload,
    occurredAt: timestamp,
    recordedAt: timestamp,
  })
  this.notifyTurnEventListeners(persisted)
}
```

Pass `streamingOnEvent` to `runTurnWithRecovery`:

```ts
const result = await this.runTurnWithRecovery(
  runtimeContext.chat,
  runtimeContext.rootPath,
  runtimeContext.chatSessionId,
  claimed.prompt,
  runtimeContext.continuationPrompt,
  seedMessages,
  session?.vendorSessionId ?? null,
  abortController.signal,
  streamingOnEvent,  // new
)
```

- [ ] **Step 3: Skip re-emitting streamed events in `finalizeSucceededTurn`**

The turn service currently calls `appendRuntimeEvents` in `finalizeSucceededTurn` to batch-persist all events. When streaming is active, the events have already been persisted by `streamingOnEvent`. To avoid duplicates, skip the batch append for events that were already streamed.

**Important nuance:** The adapter appends `assistant_final` to `result.events` after all streaming is done (e.g., Claude adapter line 229). This event is NOT streamed via `onEvent` — only `assistant_delta`, `tool_activity`, etc. are streamed during execution. So we need to persist events that weren't already streamed (specifically `assistant_final`).

Modify `finalizeSucceededTurn` to accept a flag and filter already-streamed events:

```ts
// In the call to finalizeSucceededTurn, add eventsAlreadyStreamed: true
```

Inside `finalizeSucceededTurn`, when `eventsAlreadyStreamed` is true, only persist events that were NOT streamed (i.e., `assistant_final` and any other post-completion events):

```ts
if (input.eventsAlreadyStreamed) {
  // Only persist events that weren't already streamed during execution.
  // The adapter adds assistant_final after streaming completes — it needs persisting.
  const nonStreamedEvents = input.result.events.filter(
    (e) => e.type === "assistant_final"
  )
  eventsToNotify.push(
    ...this.appendRuntimeEvents(
      input.chatId,
      input.turnId,
      nonStreamedEvents,
      timestamp,
    ),
  )
}
```

The `chat.turn_completed` event is always emitted regardless.

- [ ] **Step 4: Verify the project compiles**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run all backend tests**

Run: `cd apps/backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/chats/chat-turn-service.ts
git commit -m "feat(ulr-19): thread onEvent through turn service for real-time streaming"
```

---

### Task 6: useStreamingText Hook

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.ts`
- Create: `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// useStreamingText.test.ts
import { describe, expect, it } from "vitest"
import { deriveStreamingText } from "./useStreamingText.js"
import type { ChatTurnEventSnapshot } from "@ultra/shared"

function makeDeltaEvent(
  sequenceNumber: number,
  text: string,
): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${sequenceNumber}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber,
    eventType: "chat.turn_assistant_delta",
    source: "runtime",
    actorType: "assistant",
    actorId: null,
    payload: { text },
    occurredAt: "2026-03-19T00:00:00Z",
    recordedAt: "2026-03-19T00:00:00Z",
  }
}

function makeNonDeltaEvent(sequenceNumber: number): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${sequenceNumber}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber,
    eventType: "chat.turn_started",
    source: "system",
    actorType: "system",
    actorId: null,
    payload: {},
    occurredAt: "2026-03-19T00:00:00Z",
    recordedAt: "2026-03-19T00:00:00Z",
  }
}

describe("deriveStreamingText", () => {
  it("returns null when turn is not in flight", () => {
    const result = deriveStreamingText([], false, 0, 0)
    expect(result.streamingText).toBeNull()
    expect(result.isStreaming).toBe(false)
  })

  it("returns empty string when turn is active but no deltas yet", () => {
    const events = [makeNonDeltaEvent(1)]
    const result = deriveStreamingText(events, true, 0, 0)
    expect(result.streamingText).toBe("")
    expect(result.isStreaming).toBe(true)
  })

  it("accumulates delta text from events", () => {
    const events = [
      makeNonDeltaEvent(1),
      makeDeltaEvent(2, "Hello"),
      makeDeltaEvent(3, " world"),
    ]
    const result = deriveStreamingText(events, true, 0, 0)
    expect(result.streamingText).toBe("Hello world")
    expect(result.isStreaming).toBe(true)
  })

  it("keeps showing text when turn ends but final message not yet arrived", () => {
    const events = [
      makeDeltaEvent(1, "Hello"),
      makeDeltaEvent(2, " world"),
    ]
    // inFlightTurn is false, but messageCount unchanged (no new message yet)
    const result = deriveStreamingText(events, false, 5, 5)
    expect(result.streamingText).toBe("Hello world")
    expect(result.isStreaming).toBe(false)
  })

  it("returns null when turn ends and final message has arrived", () => {
    const events = [
      makeDeltaEvent(1, "Hello"),
    ]
    // messageCount increased = final message arrived
    const result = deriveStreamingText(events, false, 6, 5)
    expect(result.streamingText).toBeNull()
    expect(result.isStreaming).toBe(false)
  })

  it("ignores non-delta events when accumulating text", () => {
    const events = [
      makeNonDeltaEvent(1),
      makeDeltaEvent(2, "Only"),
      makeNonDeltaEvent(3),
      makeDeltaEvent(4, " this"),
    ]
    const result = deriveStreamingText(events, true, 0, 0)
    expect(result.streamingText).toBe("Only this")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chats/hooks/useStreamingText.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

```ts
// useStreamingText.ts
import { useMemo, useRef } from "react"
import type { ChatTurnEventSnapshot } from "@ultra/shared"

export interface StreamingTextState {
  streamingText: string | null
  isStreaming: boolean
}

/**
 * Pure function for testing. Derives streaming text from turn events.
 *
 * @param events - turn events for the active turn
 * @param inFlightTurn - whether a turn is currently running
 * @param messageCount - current message count (to detect final message arrival)
 * @param messageCountAtTurnStart - message count when streaming began
 */
export function deriveStreamingText(
  events: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,
  messageCountAtTurnStart: number,
): StreamingTextState {
  const deltaText = events
    .filter((e) => e.eventType === "chat.turn_assistant_delta")
    .map((e) => (e.payload as { text: string }).text)
    .join("")

  if (inFlightTurn) {
    return { streamingText: deltaText, isStreaming: true }
  }

  // Turn ended — check if the final message has arrived
  if (deltaText.length > 0 && messageCount === messageCountAtTurnStart) {
    // Race condition: turn status updated but message not yet delivered
    return { streamingText: deltaText, isStreaming: false }
  }

  return { streamingText: null, isStreaming: false }
}

/**
 * React hook that derives streaming text from turn events in the store.
 */
export function useStreamingText(
  activeTurnEvents: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,
): StreamingTextState {
  const messageCountAtTurnStartRef = useRef(messageCount)
  const prevInFlightRef = useRef(false)

  // Capture message count when turn transitions from idle to in-flight
  if (inFlightTurn && !prevInFlightRef.current) {
    messageCountAtTurnStartRef.current = messageCount
  }
  prevInFlightRef.current = inFlightTurn

  return useMemo(
    () =>
      deriveStreamingText(
        activeTurnEvents,
        inFlightTurn,
        messageCount,
        messageCountAtTurnStartRef.current,
      ),
    [activeTurnEvents, inFlightTurn, messageCount],
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chats/hooks/useStreamingText.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/hooks/useStreamingText.ts apps/desktop/src/renderer/src/chats/hooks/useStreamingText.test.ts
git commit -m "feat(ulr-19): add useStreamingText hook with tests"
```

---

### Task 7: useAutoScroll Hook

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.ts`
- Create: `apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// useAutoScroll.test.ts
import { describe, expect, it } from "vitest"
import { shouldAutoScroll } from "./useAutoScroll.js"

describe("shouldAutoScroll", () => {
  it("returns true when near bottom", () => {
    // scrollTop + clientHeight = 950, scrollHeight = 1000, threshold = 50
    expect(shouldAutoScroll(950, 1000, 50)).toBe(true)
  })

  it("returns false when scrolled up", () => {
    // scrollTop + clientHeight = 500, scrollHeight = 1000, threshold = 50
    expect(shouldAutoScroll(500, 1000, 50)).toBe(false)
  })

  it("returns true when exactly at bottom", () => {
    expect(shouldAutoScroll(1000, 1000, 50)).toBe(true)
  })

  it("returns true when container has no overflow", () => {
    // scrollTop + clientHeight >= scrollHeight
    expect(shouldAutoScroll(300, 300, 50)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chats/hooks/useAutoScroll.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

```ts
// useAutoScroll.ts
import { useEffect, useRef, type RefObject } from "react"

const NEAR_BOTTOM_THRESHOLD = 50

/**
 * Pure function for testing. Returns true if a scroll container is near its bottom.
 */
export function shouldAutoScroll(
  scrollBottom: number,
  scrollHeight: number,
  threshold: number,
): boolean {
  return scrollHeight - scrollBottom <= threshold
}

/**
 * Hook that auto-scrolls a container to the bottom when new content arrives,
 * but only if the user is already near the bottom.
 */
export function useAutoScroll(
  scrollRef: RefObject<HTMLElement | null>,
  deps: unknown[],
): void {
  const isNearBottomRef = useRef(true)

  // Track scroll position
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function handleScroll() {
      const el = scrollRef.current
      if (!el) return
      isNearBottomRef.current = shouldAutoScroll(
        el.scrollTop + el.clientHeight,
        el.scrollHeight,
        NEAR_BOTTOM_THRESHOLD,
      )
    }

    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [scrollRef])

  // Auto-scroll when deps change
  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chats/hooks/useAutoScroll.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.ts apps/desktop/src/renderer/src/chats/hooks/useAutoScroll.test.ts
git commit -m "feat(ulr-19): add useAutoScroll hook with tests"
```

---

### Task 8: ChatMessage Streaming Support

**Files:**
- Modify: `apps/desktop/src/renderer/src/chat-message/ChatMessage.tsx:6-9,20-59`
- Modify: `apps/desktop/src/renderer/src/chat-message/ChatMessage.css`

- [ ] **Step 1: Write failing test**

Add to existing test file or create `ChatMessage.test.tsx`:

```tsx
// ChatMessage.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatMessage } from "./ChatMessage.js"

describe("ChatMessage streaming", () => {
  it("renders typing indicator when streaming with empty content", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="assistant" content="" isStreaming />,
    )
    expect(html).toContain("chat-message__typing")
  })

  it("renders content normally when streaming with content", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="assistant" content="Hello world" isStreaming />,
    )
    expect(html).toContain("Hello world")
    expect(html).not.toContain("chat-message__typing")
  })

  it("returns null for empty content when NOT streaming", () => {
    const html = renderToStaticMarkup(
      <ChatMessage role="assistant" content="" />,
    )
    expect(html).toBe("")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chat-message/ChatMessage.test.tsx`
Expected: FAIL — typing indicator not rendered

- [ ] **Step 3: Add `isStreaming` prop and typing indicator**

In `ChatMessage.tsx`, update the interface:

```tsx
interface ChatMessageProps {
  role: "user" | "coordinator" | "assistant" | "system"
  content: string
  isStreaming?: boolean
}
```

Modify the component to accept `isStreaming` and handle the empty-content case:

```tsx
export function ChatMessage({ role, content, isStreaming }: ChatMessageProps): ReactElement | null {
  const [copied, setCopied] = useState(false)

  // Allow empty content when streaming (typing indicator)
  if (!content.trim() && !isStreaming) return null

  const label = ROLE_LABELS[role] || role
  const isAssistant = ASSISTANT_ROLES.has(role)
  const cssRole = isAssistant ? "coordinator" : role

  return (
    <div className={"chat-message chat-message--" + cssRole}>
      <div className="chat-message__label">{label}</div>
      <div className="chat-message__content">
        {isStreaming && !content.trim() ? (
          <div className="chat-message__typing">
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
          </div>
        ) : isAssistant ? (
          <MarkdownRenderer content={content} />
        ) : (
          <p className="chat-message__text">{content}</p>
        )}
      </div>
      {isAssistant && content.trim() && (
        <button className="chat-message__copy" onClick={handleCopy} type="button">
          {copied ? "Copied!" : "Copy message"}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add typing indicator CSS**

Append to `ChatMessage.css`:

```css
.chat-message__typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.chat-message__typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: typing-pulse 1.4s ease-in-out infinite;
}

.chat-message__typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.chat-message__typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-pulse {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chat-message/ChatMessage.test.tsx`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/chat-message/ChatMessage.tsx apps/desktop/src/renderer/src/chat-message/ChatMessage.css apps/desktop/src/renderer/src/chat-message/ChatMessage.test.tsx
git commit -m "feat(ulr-19): add streaming support and typing indicator to ChatMessage"
```

---

### Task 9: Wire Streaming into ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

- [ ] **Step 1: Add imports**

Add to the import section:

```ts
import { useStreamingText } from "../chats/hooks/useStreamingText.js"
import { useAutoScroll } from "../chats/hooks/useAutoScroll.js"
```

- [ ] **Step 2: Add scroll ref to transcript container**

Add a ref near the other refs in the component:

```ts
const transcriptScrollRef = useRef<HTMLDivElement>(null)
```

Attach it to the transcript scroll container (the div with className `active-chat-pane__transcript-scroll`):

```tsx
<div className="active-chat-pane__transcript-scroll" ref={transcriptScrollRef}>
```

- [ ] **Step 3: Wire the streaming hooks**

After the existing `activeTurnEvents` derivation (around line 404), add:

```ts
const { streamingText, isStreaming } = useStreamingText(
  activeTurnEvents,
  inFlightTurn,
  activeChatMessages.length,
)

useAutoScroll(transcriptScrollRef, [activeChatMessages, streamingText])
```

- [ ] **Step 4: Render the streaming message**

After the message map loop (after the closing `})}` of the messages map), add:

```tsx
{streamingText !== null && (
  <ChatMessage
    role="assistant"
    content={streamingText}
    isStreaming={isStreaming}
  />
)}
```

- [ ] **Step 5: Run all frontend tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ChatPageShell.tsx
git commit -m "feat(ulr-19): wire streaming text and auto-scroll into ChatPageShell"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run full frontend test suite**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Start dev server and verify visually**

Run: `cd .claude/worktrees/ulr-19-chat-streaming && pnpm dev`

Verify:
- Send a message in a chat
- Typing indicator (pulsing dots) appears immediately in assistant position
- Text streams in token-by-token as the model responds
- Markdown renders live during streaming (code blocks, bold, etc.)
- When response completes, streaming message is replaced by final persisted message
- Scroll follows streaming text when at bottom
- Scrolling up during streaming stays at your position (doesn't jump to bottom)
- Scrolling back to bottom resumes auto-scroll

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(ulr-19): end-to-end streaming verification and cleanup"
```
