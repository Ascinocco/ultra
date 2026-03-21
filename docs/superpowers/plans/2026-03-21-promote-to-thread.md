# Promote to Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-step approval flow with a single "Promote to Thread" action using `/plan` markers, `/promote` command, and a promote drawer UI.

**Architecture:** Frontend intercepts `/plan` and `/promote` commands before they reach the LLM. Context gathering collects message IDs based on plan markers or a "since last thread" window. A new `chats.promote_to_thread` IPC command creates the thread with seed context stored as JSON on the thread record.

**Tech Stack:** TypeScript, React, Zod, SQLite (better-sqlite3), Vitest

**Spec:** `docs/superpowers/specs/2026-03-21-promote-to-thread-design.md`

---

### Task 1: Add `seed_context_json` column to threads table

**Files:**
- Modify: `apps/backend/src/db/migrations.ts`

- [ ] **Step 1: Add migration 0014**

Add after the `0013_user_worktree_sandbox_type` migration entry:

```typescript
{
  id: "0014_thread_seed_context",
  sql: `ALTER TABLE threads ADD COLUMN seed_context_json TEXT;`,
},
```

- [ ] **Step 2: Run backend to verify migration applies**

Run: `cd apps/backend && npx tsx src/index.ts`
Expected: Backend starts, log shows "1 migrations applied"
Kill the process after confirming.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/migrations.ts
git commit -m "feat(db): add seed_context_json column to threads table"
```

---

### Task 2: Add new IPC command schema and message types

**Files:**
- Modify: `packages/shared/src/contracts/threads.ts`
- Modify: `packages/shared/src/contracts/chats.ts`
- Modify: `packages/shared/src/contracts/ipc.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add `chatsPromoteToThreadInputSchema` in `threads.ts`**

Add after the existing `chatsPromoteWorkToThreadInputSchema` (around line 228):

```typescript
export const chatsPromoteToThreadInputSchema = z.object({
  chat_id: chatIdSchema,
  title: z.string().min(1),
  context_message_ids: z.array(opaqueIdSchema).min(1),
})

export type ChatsPromoteToThreadInput = z.infer<typeof chatsPromoteToThreadInputSchema>

export const chatsPromoteToThreadCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("chats.promote_to_thread"),
    payload: chatsPromoteToThreadInputSchema,
  })

export const chatsPromoteToThreadSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: threadDetailResultSchema,
  })
```

- [ ] **Step 2: Add plan marker schema in `chats.ts`**

Add after the existing approval schemas:

```typescript
export const chatsCreatePlanMarkerInputSchema = z.object({
  chat_id: chatIdSchema,
  marker_type: z.enum(["open", "close"]),
})
```

- [ ] **Step 3: Register new commands in `ipc.ts`**

Add `"chats.promote_to_thread"` and `"chats.create_plan_marker"` to the `commandMethodSchema` z.enum array.

- [ ] **Step 4: Export new types from `packages/shared/src/index.ts`**

Add exports for `chatsPromoteToThreadInputSchema`, `ChatsPromoteToThreadInput`, `chatsCreatePlanMarkerInputSchema`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add promote_to_thread and plan_marker IPC schemas"
```

---

### Task 3: Backend handler for `chats.create_plan_marker`

**Files:**
- Modify: `apps/backend/src/ipc/router.ts`
- Modify: `apps/backend/src/chats/chat-service.ts`

- [ ] **Step 1: Add `createPlanMarker` method to ChatService**

Add in `chat-service.ts` after `confirmStartWork`:

```typescript
createPlanMarker(chatId: ChatId, markerType: "open" | "close"): ChatMessageSnapshot {
  this.get(chatId)

  return this.appendMessage({
    chatId,
    role: "user",
    messageType: markerType === "open" ? "plan_marker_open" : "plan_marker_close",
    contentMarkdown: markerType === "open" ? "Planning started" : "Planning complete",
  })
}
```

- [ ] **Step 2: Add router handler in `router.ts`**

Add a new case in the command switch:

```typescript
case "chats.create_plan_marker": {
  const markerCommand = assertCommandRequest(request)
  const { chat_id, marker_type } = chatsCreatePlanMarkerInputSchema.parse(
    markerCommand.payload,
  )
  const marker = services.chatService.createPlanMarker(chat_id, marker_type)
  return createSuccessResponse(markerCommand.request_id, marker)
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/ipc/router.ts apps/backend/src/chats/chat-service.ts
git commit -m "feat(backend): add chats.create_plan_marker IPC handler"
```

---

### Task 4: Backend handler for `chats.promote_to_thread`

**Files:**
- Modify: `apps/backend/src/ipc/router.ts`
- Modify: `apps/backend/src/threads/thread-service.ts`

- [ ] **Step 1: Add `promoteToThread` method to ThreadService**

Add after `promoteWorkToThread` in `thread-service.ts`. This method:
1. Validates the chat exists
2. Looks up each message by ID from the database
3. Serializes them as `seed_context_json`
4. Creates a `thread_start_request` message in the chat (for the divider)
5. Creates the thread record with `seedContextJson`
6. Dispatches to coordinator (if configured)
7. Returns `ThreadDetailResult`

```typescript
promoteToThread(input: ChatsPromoteToThreadInput): ThreadDetailResult {
  const chat = this.assertChatExists(input.chat_id)

  const messages = input.context_message_ids.map((msgId) => {
    const row = this.database
      .prepare(
        `SELECT id, role, message_type, content_markdown, structured_payload_json
         FROM chat_messages WHERE id = ? AND chat_id = ?`,
      )
      .get(msgId, input.chat_id) as {
        id: string; role: string; message_type: string
        content_markdown: string | null; structured_payload_json: string | null
      } | undefined

    if (!row) {
      throw new IpcProtocolError("not_found", `Message ${msgId} not found in chat ${input.chat_id}`)
    }
    return row
  })

  const seedContextJson = JSON.stringify(
    messages.map((m) => ({
      id: m.id, role: m.role, messageType: m.message_type, content: m.content_markdown,
    })),
  )

  const startMessage = this.chatService.appendMessage({
    chatId: input.chat_id,
    role: "user",
    messageType: "thread_start_request",
    contentMarkdown: `Thread promoted: ${input.title}`,
    structuredPayloadJson: JSON.stringify({
      type: "thread_promotion", title: input.title, contextMessageCount: messages.length,
    }),
  })

  const threadId = this.createThreadWithInitialEvent(
    {
      projectId: chat.projectId,
      sourceChatId: input.chat_id,
      title: input.title,
      summary: null,
      createdByMessageId: startMessage.id,
      seedContextJson,
    },
    [], [],
    { type: "thread.created", creationSource: "promotion", contextMessageCount: messages.length },
  )

  return this.getThread(threadId)
}
```

- [ ] **Step 2: Update `createThreadWithInitialEvent` to store `seed_context_json`**

Find the INSERT INTO threads statement in `createThreadWithInitialEvent` and add `seed_context_json` to both the column list and the values. Accept it as an optional field on the input object.

- [ ] **Step 3: Add router handler in `router.ts`**

```typescript
case "chats.promote_to_thread": {
  const promoteCommand = assertCommandRequest(request)
  const parsed = chatsPromoteToThreadInputSchema.parse(promoteCommand.payload)
  return createSuccessResponse(
    promoteCommand.request_id,
    services.threadService.promoteToThread(parsed),
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/ipc/router.ts apps/backend/src/threads/thread-service.ts
git commit -m "feat(backend): add chats.promote_to_thread IPC handler"
```

---

### Task 5: Frontend — `gatherPromoteContext` and workflow functions

**Files:**
- Modify: `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts`

- [ ] **Step 1: Add `gatherPromoteContext` function**

```typescript
export function gatherPromoteContext(messages: ChatMessageSnapshot[]): string[] {
  let lastOpenIdx = -1
  let lastCloseIdx = -1

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.messageType === "plan_marker_close" && lastCloseIdx === -1) lastCloseIdx = i
    if (msg.messageType === "plan_marker_open" && lastOpenIdx === -1) lastOpenIdx = i
  }

  // Matched pair
  if (lastOpenIdx !== -1 && lastCloseIdx !== -1 && lastCloseIdx > lastOpenIdx) {
    return messages.slice(lastOpenIdx + 1, lastCloseIdx)
      .filter((m) => !m.messageType?.startsWith("plan_marker"))
      .map((m) => m.id)
  }

  // Unclosed marker
  if (lastOpenIdx !== -1 && (lastCloseIdx === -1 || lastCloseIdx < lastOpenIdx)) {
    return messages.slice(lastOpenIdx + 1)
      .filter((m) => !m.messageType?.startsWith("plan_marker"))
      .map((m) => m.id)
  }

  // No markers: since last thread_start_request
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].messageType === "thread_start_request") {
      return messages.slice(i + 1).map((m) => m.id)
    }
  }

  // No markers, no threads: all messages
  return messages.map((m) => m.id)
}
```

- [ ] **Step 2: Add `promoteToThread` and `createPlanMarker` workflow functions**

```typescript
export async function promoteToThread(
  chatId: string,
  title: string,
  contextMessageIds: string[],
  client: WorkflowClient = ipcClient,
): Promise<ThreadDetailResult> {
  const result = await client.command("chats.promote_to_thread", {
    chat_id: chatId, title, context_message_ids: contextMessageIds,
  })
  return parseThreadDetailResult(result)
}

export async function createPlanMarker(
  chatId: string,
  markerType: "open" | "close",
  actions: Pick<AppActions, "upsertChatMessage">,
  client: WorkflowClient = ipcClient,
): Promise<ChatMessageSnapshot> {
  const result = await client.command("chats.create_plan_marker", {
    chat_id: chatId, marker_type: markerType,
  })
  const marker = parseChatMessageSnapshot(result)
  actions.upsertChatMessage(chatId, marker)
  return marker
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/chat-message-workflows.ts
git commit -m "feat(frontend): add gatherPromoteContext and promoteToThread workflows"
```

---

### Task 6: Frontend — `PromoteDrawer` component

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/promote-drawer/PromoteDrawer.tsx`
- Create: `apps/desktop/src/renderer/src/chats/promote-drawer/promote-drawer.css`

- [ ] **Step 1: Create `promote-drawer.css`**

```css
.promote-drawer__lip {
  display: flex;
  justify-content: center;
  padding: 3px 0;
  background: #1e2030;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.promote-drawer__lip:hover { background: #232538; }

.promote-drawer__expanded {
  background: #1e2030;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 6px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.promote-drawer__chevron { cursor: pointer; flex-shrink: 0; color: #565f89; }
.promote-drawer__info { flex: 1; display: flex; align-items: center; justify-content: space-between; }
.promote-drawer__label { color: #c0caf5; font-size: 12px; font-weight: 500; }
.promote-drawer__count { color: #565f89; font-size: 11px; margin-left: 8px; }

.promote-drawer__button {
  background: rgba(187, 154, 247, 0.15);
  color: #bb9af7;
  border: 1px solid rgba(187, 154, 247, 0.3);
  border-radius: 5px;
  padding: 4px 12px;
  font-size: 11px;
  cursor: pointer;
}

.promote-drawer__button:hover { background: rgba(187, 154, 247, 0.25); }
.promote-drawer__button:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 2: Create `PromoteDrawer.tsx`**

```tsx
import { useState, type ReactElement } from "react"
import "./promote-drawer.css"

type Props = {
  messageCount: number
  disabled: boolean
  onPromote: () => void
}

function ChevronUp() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 6L8 2L13 6" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 2L8 6L13 2" />
    </svg>
  )
}

export function PromoteDrawer({ messageCount, disabled, onPromote }: Props): ReactElement | null {
  const [expanded, setExpanded] = useState(false)

  if (messageCount < 3) return null

  if (!expanded) {
    return (
      <div className="promote-drawer__lip" onClick={() => setExpanded(true)}>
        <span className="promote-drawer__chevron"><ChevronUp /></span>
      </div>
    )
  }

  return (
    <div className="promote-drawer__expanded">
      <span className="promote-drawer__chevron" onClick={() => setExpanded(false)}>
        <ChevronDown />
      </span>
      <div className="promote-drawer__info">
        <div>
          <span className="promote-drawer__label">Promote to Thread</span>
          <span className="promote-drawer__count">{messageCount} messages</span>
        </div>
        <button className="promote-drawer__button" disabled={disabled}
          onClick={onPromote} type="button">
          ⬆ Promote
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/promote-drawer/
git commit -m "feat(frontend): add PromoteDrawer component"
```

---

### Task 7: Frontend — Wire into ChatPageShell and InputDock

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`
- Modify: `apps/desktop/src/renderer/src/chats/input-dock/InputDock.tsx`
- Modify: `apps/desktop/src/renderer/src/chats/approval-divider/ApprovalDivider.tsx`

- [ ] **Step 1: Update `ApprovalDivider` to support plan marker types**

Add `plan_marker_open` and `plan_marker_close` to the props type and label map. Update the `thread_start_request` label from "Work started" to "Thread created".

- [ ] **Step 2: Add `/plan` and `/promote` interception to `InputDock`**

Add props: `onPlanMarker?: (type: "open" | "close") => void`, `onPromote?: () => void`, `planMarkerOpen?: boolean`.

In the submit handler, before `onSend`:
- If prompt is `/plan`, call `onPlanMarker` with appropriate type, clear input, return
- If prompt is `/promote`, call `onPromote`, clear input, return

- [ ] **Step 3: Wire `PromoteDrawer` and handlers into `ChatPageShell`**

Add state: `planMarkerOpen` boolean.

Add computed: `contextMessageIds` via `gatherPromoteContext(activeChatMessages)`.

Add computed: `hasPromotedRecently` — true if last `thread_start_request` has no subsequent user messages.

Add handlers: `handlePlanMarker`, `handlePromote`.

Render `<PromoteDrawer>` between transcript section and InputDock.

Add plan marker message types to the divider rendering condition in the message map.

Pass `onPlanMarker`, `onPromote`, `planMarkerOpen` to InputDock.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ChatPageShell.tsx apps/desktop/src/renderer/src/chats/input-dock/InputDock.tsx apps/desktop/src/renderer/src/chats/approval-divider/ApprovalDivider.tsx
git commit -m "feat(frontend): wire promote drawer, /plan and /promote into chat shell"
```

---

### Task 8: Remove old approval flow code

**Files:**
- Delete: `apps/desktop/src/renderer/src/chats/approval-bar/` (entire directory)
- Delete: `apps/desktop/src/renderer/src/chats/hooks/useApprovalState.ts`
- Modify: `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

- [ ] **Step 1: Delete ApprovalBar directory and useApprovalState hook**

```bash
rm -rf apps/desktop/src/renderer/src/chats/approval-bar/
rm apps/desktop/src/renderer/src/chats/hooks/useApprovalState.ts
```

- [ ] **Step 2: Remove `approvePlan` and `approveSpecs` from `chat-message-workflows.ts`**

Delete the functions and their type aliases. Keep `startThreadFromChat` for backwards compatibility.

- [ ] **Step 3: Remove old approval imports and handlers from `ChatPageShell.tsx`**

Remove: imports of `ApprovalBar`, `useApprovalState`, `approvePlan`, `approveSpecs`. Remove `approvalState` usage and `handleApprovePlan`, `handleApproveSpecs`, `handleStartWork`.

- [ ] **Step 4: Verify no build errors from removals**

Run: `npx tsc --noEmit -p apps/desktop/tsconfig.json 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old 3-step approval flow (ApprovalBar, useApprovalState, approvePlan, approveSpecs)"
```

---

### Task 9: Manual integration test

- [ ] **Step 1: Start the app and test `/plan` markers**

Open a chat, send a message. Type `/plan` — verify divider appears, not sent to LLM. Chat with LLM. Type `/plan` again — verify close divider.

- [ ] **Step 2: Test promote drawer**

Verify chevron lip appears. Click to expand. Verify message count. Click Promote. Verify "Thread created" divider appears in chat. Verify thread in thread pane. Verify button disables.

- [ ] **Step 3: Test `/promote` command**

New chat, brief conversation, type `/promote`. Verify thread created.

- [ ] **Step 4: Test edge cases**

Empty chat `/promote` — error. Double promote — disabled. Unclosed `/plan` then `/promote` — uses open marker to end.
