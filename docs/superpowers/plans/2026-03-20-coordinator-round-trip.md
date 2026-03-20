# Coordinator Conversation Round-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the thread coordinator conversation end-to-end so users can send messages, see streaming responses, and distinguish message types visually.

**Architecture:** Add `partial` field to thread message schema. Backend emits partial messages for streaming, final message persists to SQLite. Frontend subscribes to `threads.messages`, upserts messages in store (dedup by ID), renders per-type with a new `CoordinatorMessage` component.

**Tech Stack:** TypeScript, React, Zustand store, Zod schemas, IPC subscriptions

**Spec:** `docs/superpowers/specs/2026-03-20-coordinator-round-trip-design.md`

---

### Task 1: Add `partial` field to thread message schema

**Files:**
- Modify: `packages/shared/src/contracts/threads.ts:280-290`

- [ ] **Step 1: Add `partial` to `threadMessageSnapshotSchema`**

In `packages/shared/src/contracts/threads.ts`, find `threadMessageSnapshotSchema` (line 280) and add `partial` as an optional boolean:

```typescript
export const threadMessageSnapshotSchema = z.object({
  id: opaqueIdSchema,
  threadId: threadIdSchema,
  role: threadMessageRoleSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  messageType: threadMessageTypeSchema,
  content: threadMessageContentSchema,
  artifactRefs: z.array(z.string()),
  createdAt: isoUtcTimestampSchema,
  partial: z.boolean().optional(),
})
```

- [ ] **Step 2: Run shared package tests**

Run: `npx vitest run packages/shared/`
Expected: PASS (optional field is backwards-compatible)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/contracts/threads.ts
git commit -m "feat(schema): add optional partial field to thread message snapshot"
```

---

### Task 2: Store deduplication — change `appendMessage` to upsert

**Files:**
- Modify: `apps/desktop/src/renderer/src/state/app-store.tsx:983-996`

- [ ] **Step 1: Replace `appendMessage` with upsert logic**

In `apps/desktop/src/renderer/src/state/app-store.tsx`, find the `appendMessage` action (line 983). Replace the naive array append with upsert-by-ID logic:

```typescript
      appendMessage: (threadId, message) =>
        set((state) => {
          const existing = state.threads.messagesByThreadId[threadId] ?? []
          const idx = existing.findIndex((m) => m.id === message.id)
          const updated =
            idx >= 0
              ? existing.map((m, i) => (i === idx ? message : m))
              : [...existing, message]
          return {
            ...state,
            threads: {
              ...state.threads,
              messagesByThreadId: {
                ...state.threads.messagesByThreadId,
                [threadId]: updated,
              },
            },
          }
        }),
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/state/app-store.tsx
git commit -m "feat(store): upsert thread messages by ID to prevent duplicates"
```

---

### Task 3: Add `subscribeToThreadMessages` workflow and subscription hook

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/thread-workflows.ts`
- Create: `apps/desktop/src/renderer/src/threads/hooks/useThreadSubscription.ts`

- [ ] **Step 1: Update WorkflowClient type**

In `thread-workflows.ts` (line 12), add `subscribe` to the type:

```typescript
type WorkflowClient = Pick<typeof ipcClient, "query" | "command" | "subscribe">
```

- [ ] **Step 2: Add `subscribeToThreadMessages` function**

Add after `sendThreadMessage` (line 77):

```typescript
type SubscribeMessagesActions = Pick<AppActions, "appendMessage">

export async function subscribeToThreadMessages(
  threadId: string,
  actions: SubscribeMessagesActions,
  client: WorkflowClient = ipcClient,
): Promise<() => Promise<void>> {
  return client.subscribe(
    "threads.messages",
    { thread_id: threadId },
    (event) => {
      const parsed = parseThreadsMessagesEvent(event)
      actions.appendMessage(parsed.payload.threadId, parsed.payload)
    },
  )
}
```

Also add `parseThreadsMessagesEvent` to the import from `@ultra/shared`.

- [ ] **Step 3: Create `useThreadSubscription` hook**

Create `apps/desktop/src/renderer/src/threads/hooks/useThreadSubscription.ts`:

```typescript
import { useEffect, useRef } from "react"

import type { AppActions } from "../../state/app-store.js"
import { fetchThreadMessages, subscribeToThreadMessages } from "../thread-workflows.js"

type SubscriptionActions = Pick<AppActions, "appendMessage" | "setMessagesForThread">

export function useThreadSubscription(
  threadId: string | null,
  actions: SubscriptionActions,
): void {
  const unsubscribeRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!threadId) return

    // Fetch current messages first
    void fetchThreadMessages(threadId, actions)

    // Then subscribe for live updates
    void subscribeToThreadMessages(threadId, actions).then((unsub) => {
      unsubscribeRef.current = unsub
    })

    return () => {
      if (unsubscribeRef.current) {
        void unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [threadId])
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/thread-workflows.ts apps/desktop/src/renderer/src/threads/hooks/useThreadSubscription.ts
git commit -m "feat(threads): add message subscription workflow and useThreadSubscription hook"
```

---

### Task 4: Wire subscription into ThreadPane/ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/ThreadPane.tsx`
- Modify: The parent component that renders ThreadPane (in `ChatPageShell.tsx`)

- [ ] **Step 1: Add subscription hook call in the parent**

Find where `ThreadPane` is rendered in `ChatPageShell.tsx`. The parent already provides `onFetchMessages` and `onSendMessage` callbacks. Add the subscription hook call nearby:

```typescript
import { useThreadSubscription } from "../threads/hooks/useThreadSubscription.js"
```

Then call it with the selected thread ID:

```typescript
const selectedThreadId = activeProjectId
  ? (layout.byProjectId[activeProjectId]?.selectedThreadId ?? null)
  : null

useThreadSubscription(selectedThreadId, actions)
```

- [ ] **Step 2: Remove the manual fetch useEffect from ThreadPane**

In `ThreadPane.tsx` (lines 29-34), the `useEffect` that calls `onFetchMessages` on thread select is now redundant — the hook handles it. Remove:

```typescript
  // DELETE THIS BLOCK:
  // biome-ignore lint/correctness/useExhaustiveDependencies: onFetchMessages is stable
  useEffect(() => {
    if (selectedThreadId) {
      onFetchMessages(selectedThreadId)
    }
  }, [selectedThreadId])
```

Also remove `onFetchMessages` from the props type and the `useEffect` import if no longer needed.

- [ ] **Step 3: Run the dev server and verify subscription works**

Run: `npm run dev`
Open a thread — messages should load. If the coordinator sends a response, it should appear without manual refresh.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ChatPageShell.tsx apps/desktop/src/renderer/src/threads/ThreadPane.tsx
git commit -m "feat(threads): wire message subscription to thread selection lifecycle"
```

---

### Task 5: Backend streaming — emit partial messages from coordinator

**Files:**
- Modify: `apps/backend/src/threads/thread-service.ts`
- Modify: `apps/backend/src/runtime/coordinator-service.ts`

- [ ] **Step 1: Add `notifyPartialMessage` to ThreadService**

In `apps/backend/src/threads/thread-service.ts`, add a method that notifies listeners with a partial message snapshot WITHOUT persisting to SQLite:

```typescript
  notifyPartialMessage(threadId: string, message: ThreadMessageSnapshot): void {
    const listeners = this.messageListenersByThreadId.get(threadId)
    if (!listeners) return
    for (const listener of listeners) {
      listener({ ...message, partial: true })
    }
  }
```

The existing `appendMessage` method already persists + notifies. Partial messages skip persistence.

- [ ] **Step 2: Update `applyThreadMessage` in coordinator-service to support partials**

In `apps/backend/src/runtime/coordinator-service.ts`, find `applyThreadMessage` (line 794). Check for a `partial` field in the event payload. If `partial === true`, call `notifyPartialMessage` instead of `appendMessage`:

```typescript
  private applyThreadMessage(
    projectId: ProjectId,
    event: CoordinatorEventEnvelope,
  ): void {
    if (typeof event.thread_id !== "string" || !event.payload) {
      return
    }

    const isPartial = event.payload.partial === true

    const messageSnapshot = {
      attachments: Array.isArray(event.payload.attachments)
        ? (event.payload.attachments.filter(
            isRecord,
          ) as ThreadMessageAttachment[])
        : [],
      contentText:
        typeof event.payload.content_markdown === "string"
          ? event.payload.content_markdown
          : typeof event.payload.text === "string"
            ? event.payload.text
            : "",
      createdAt: event.occurred_at ?? this.now(),
      messageType: normalizeThreadMessageType(event.payload.message_type),
      projectId,
      role: normalizeThreadMessageRole(event.payload.role),
      threadId: event.thread_id,
      ...(typeof event.payload.message_id === "string"
        ? { messageId: event.payload.message_id }
        : {}),
    }

    if (isPartial) {
      // Build a snapshot-shaped object for the subscription without persisting
      this.threadService.notifyPartialMessage(event.thread_id, {
        id: messageSnapshot.messageId ?? `partial_${Date.now()}`,
        threadId: event.thread_id,
        role: messageSnapshot.role,
        provider: null,
        model: null,
        messageType: messageSnapshot.messageType,
        content: { text: messageSnapshot.contentText },
        artifactRefs: [],
        createdAt: messageSnapshot.createdAt,
        partial: true,
      })
    } else {
      this.threadService.appendMessage(messageSnapshot)
    }
  }
```

- [ ] **Step 3: Run backend tests**

Run: `npx vitest run apps/backend/src/threads/ apps/backend/src/runtime/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/threads/thread-service.ts apps/backend/src/runtime/coordinator-service.ts
git commit -m "feat(backend): support partial message emission for coordinator streaming"
```

---

### Task 6: Create `useThreadStreaming` hook

**Files:**
- Create: `apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.ts`
- Create: `apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

import { mergeStreamingMessages } from "./useThreadStreaming.js"

describe("mergeStreamingMessages", () => {
  it("appends a new complete message", () => {
    const existing = [
      { id: "msg_1", content: { text: "hello" }, partial: undefined },
    ]
    const incoming = {
      id: "msg_2",
      content: { text: "world" },
      partial: undefined,
    }
    const result = mergeStreamingMessages(existing as any, incoming as any)
    expect(result).toHaveLength(2)
    expect(result[1].id).toBe("msg_2")
  })

  it("updates an existing partial message in place", () => {
    const existing = [
      { id: "msg_1", content: { text: "hel" }, partial: true },
    ]
    const incoming = {
      id: "msg_1",
      content: { text: "hello wor" },
      partial: true,
    }
    const result = mergeStreamingMessages(existing as any, incoming as any)
    expect(result).toHaveLength(1)
    expect(result[0].content.text).toBe("hello wor")
    expect(result[0].partial).toBe(true)
  })

  it("finalizes a partial message when partial is absent", () => {
    const existing = [
      { id: "msg_1", content: { text: "hello wor" }, partial: true },
    ]
    const incoming = {
      id: "msg_1",
      content: { text: "hello world" },
      partial: undefined,
    }
    const result = mergeStreamingMessages(existing as any, incoming as any)
    expect(result).toHaveLength(1)
    expect(result[0].content.text).toBe("hello world")
    expect(result[0].partial).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the hook**

Create `apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.ts`:

```typescript
import type { ThreadMessageSnapshot } from "@ultra/shared"

/**
 * Merge an incoming message into the existing list by ID.
 * If the message ID exists, replace it (streaming update).
 * If new, append it.
 */
export function mergeStreamingMessages(
  existing: ThreadMessageSnapshot[],
  incoming: ThreadMessageSnapshot,
): ThreadMessageSnapshot[] {
  const idx = existing.findIndex((m) => m.id === incoming.id)
  if (idx >= 0) {
    return existing.map((m, i) => (i === idx ? incoming : m))
  }
  return [...existing, incoming]
}
```

Note: The actual merge logic lives in the store's `appendMessage` (which we already made upsert in Task 2). This exported function is for any component-level state that needs the same logic. The hook pattern can be expanded later when streaming indicators are needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.ts apps/desktop/src/renderer/src/threads/hooks/useThreadStreaming.test.ts
git commit -m "feat(threads): add mergeStreamingMessages utility for partial message updates"
```

---

### Task 7: Create `CoordinatorMessage` component with per-type rendering

**Files:**
- Create: `apps/desktop/src/renderer/src/threads/CoordinatorMessage.tsx`
- Create: `apps/desktop/src/renderer/src/threads/CoordinatorMessage.test.tsx`

- [ ] **Step 1: Write the test**

Create `apps/desktop/src/renderer/src/threads/CoordinatorMessage.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"

import { CoordinatorMessage } from "./CoordinatorMessage.js"

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    threadId: "thread_1",
    role: "coordinator" as const,
    provider: null,
    model: null,
    messageType: "text" as const,
    content: { text: "Hello" },
    artifactRefs: [],
    createdAt: "2026-03-20T00:00:00Z",
    ...overrides,
  }
}

describe("CoordinatorMessage", () => {
  it("renders text type as a standard message", () => {
    const { container } = render(
      <CoordinatorMessage message={makeMessage()} />,
    )
    expect(container.querySelector(".coord-msg--text")).toBeTruthy()
  })

  it("renders status type with status styling", () => {
    const { container } = render(
      <CoordinatorMessage message={makeMessage({ messageType: "status" })} />,
    )
    expect(container.querySelector(".coord-msg--status")).toBeTruthy()
  })

  it("renders blocking_question with attention styling", () => {
    const { container } = render(
      <CoordinatorMessage
        message={makeMessage({ messageType: "blocking_question" })}
      />,
    )
    expect(container.querySelector(".coord-msg--blocking-question")).toBeTruthy()
  })

  it("renders system role as status regardless of messageType", () => {
    const { container } = render(
      <CoordinatorMessage
        message={makeMessage({ role: "system", messageType: "text" })}
      />,
    )
    expect(container.querySelector(".coord-msg--system")).toBeTruthy()
  })

  it("shows streaming indicator when partial is true", () => {
    const { container } = render(
      <CoordinatorMessage message={makeMessage({ partial: true })} />,
    )
    expect(container.querySelector(".coord-msg--streaming")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/src/threads/CoordinatorMessage.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the component**

Create `apps/desktop/src/renderer/src/threads/CoordinatorMessage.tsx`:

```tsx
import type { ThreadMessageSnapshot } from "@ultra/shared"

function getMessageClass(message: ThreadMessageSnapshot): string {
  if (message.role === "system") return "coord-msg coord-msg--system"

  const typeClass = message.messageType.replace(/_/g, "-")
  const base = `coord-msg coord-msg--${typeClass}`
  const roleClass = `coord-msg--role-${message.role}`
  const streamClass = message.partial ? " coord-msg--streaming" : ""
  return `${base} ${roleClass}${streamClass}`
}

export function CoordinatorMessage({
  message,
}: {
  message: ThreadMessageSnapshot
}) {
  return (
    <div className={getMessageClass(message)}>
      <div className="coord-msg__content">{message.content.text}</div>
      {message.partial && (
        <span className="coord-msg__streaming-indicator" aria-label="Streaming">
          ...
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/desktop/src/renderer/src/threads/CoordinatorMessage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/CoordinatorMessage.tsx apps/desktop/src/renderer/src/threads/CoordinatorMessage.test.tsx
git commit -m "feat(threads): add CoordinatorMessage component with per-type rendering"
```

---

### Task 8: Wire CoordinatorMessage into CoordinatorConversation

**Files:**
- Modify: `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx`

- [ ] **Step 1: Replace ChatMessage with CoordinatorMessage**

In `ThreadDetail.tsx`, in the `CoordinatorConversation` component (line 49-109):

1. Import `CoordinatorMessage`:
```typescript
import { CoordinatorMessage } from "./CoordinatorMessage.js"
```

2. Replace the `ChatMessage` rendering (lines 76-82):

```tsx
          messages.map((msg) => (
            <CoordinatorMessage key={msg.id} message={msg} />
          ))
```

3. Remove the `ChatMessage` import if no longer used in this file.

- [ ] **Step 2: Add sending state to prevent double-send**

Add a `sending` state to `CoordinatorConversation`:

```typescript
const [sending, setSending] = useState(false)

async function handleSubmit(e: React.FormEvent) {
  e.preventDefault()
  const trimmed = inputValue.trim()
  if (!trimmed || sending) return
  setSending(true)
  try {
    onSendMessage(trimmed)
    setInputValue("")
  } finally {
    setSending(false)
  }
}
```

Disable the input and button while sending:
```tsx
<input
  ...
  disabled={sending}
/>
<button
  ...
  disabled={!inputValue.trim() || sending}
>
  {sending ? "Sending..." : "Send"}
</button>
```

- [ ] **Step 3: Add Enter-to-send on input**

Add onKeyDown to the input element:

```tsx
<input
  ...
  onKeyDown={(e) => {
    if (e.key === "Enter" && !e.shiftKey && inputValue.trim() && !sending) {
      e.preventDefault()
      const form = e.currentTarget.closest("form")
      if (form) form.requestSubmit()
    }
  }}
/>
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/threads/ThreadDetail.tsx
git commit -m "feat(threads): wire CoordinatorMessage and enhance send flow"
```

---

### Task 9: Add CSS for coordinator message types

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Add coordinator message styles**

Find the thread-related CSS section and add:

```css
/* Coordinator Message Types */
.coord-msg {
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.25rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  line-height: 1.4;
}

.coord-msg--role-user {
  background: var(--color-surface-elevated, #2d3748);
  margin-left: 2rem;
}

.coord-msg--role-coordinator {
  background: var(--color-surface, #1a202c);
  margin-right: 2rem;
}

.coord-msg--system,
.coord-msg--status {
  background: none;
  color: var(--color-text-muted, #718096);
  font-style: italic;
  font-size: 0.8125rem;
  padding: 0.25rem 0.75rem;
  text-align: center;
}

.coord-msg--blocking-question {
  background: var(--color-warning-bg, #744210);
  border-left: 3px solid var(--color-warning, #ecc94b);
  padding: 0.625rem 0.75rem;
}

.coord-msg--summary {
  background: var(--color-surface-elevated, #2d3748);
  border-left: 3px solid var(--color-text-muted, #718096);
}

.coord-msg--review-ready {
  background: var(--color-success-bg, #22543d);
  border-left: 3px solid var(--color-success, #48bb78);
}

.coord-msg--change-request-followup {
  background: var(--color-warning-bg, #744210);
  border-left: 3px solid var(--color-warning, #ecc94b);
}

.coord-msg--streaming .coord-msg__content {
  opacity: 0.85;
}

.coord-msg__streaming-indicator {
  display: inline-block;
  animation: coord-msg-pulse 1s infinite;
  color: var(--color-text-muted, #718096);
}

@keyframes coord-msg-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "style: add coordinator message type styles"
```

---

### Task 10: Manual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` from the project root.

- [ ] **Step 2: Test message subscription**

1. Open the app, navigate to a project with threads
2. Select a thread — messages should load
3. If the coordinator is running, send a message — the response should appear in real-time without refresh

- [ ] **Step 3: Test message type rendering**

1. Verify user messages appear right-aligned with elevated background
2. Verify coordinator messages appear left-aligned
3. If status/system messages exist, verify they appear as centered italic text

- [ ] **Step 4: Test send flow**

1. Type a message, press Enter — should submit
2. Button should show "Sending..." briefly
3. Input should clear on success

- [ ] **Step 5: Test reconnect**

1. Kill and restart the backend
2. Messages should refetch when the thread is re-selected
