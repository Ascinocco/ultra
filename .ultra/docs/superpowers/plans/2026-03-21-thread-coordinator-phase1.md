# Thread Coordinator Phase 1 — Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the thread coordinator backend so that promoting a chat to a thread spawns an autonomous Claude SDK session that executes the implementation plan from seed context.

**Architecture:** A new `ThreadTurnService` manages coordinator sessions using the same `ClaudeChatRuntimeAdapter` as chat turns. A `CoordinatorPromptBuilder` constructs the initial prompt from `seed_context_json` (messages, artifacts, attachments). The coordinator dispatch handler in `index.ts` is updated to call `ThreadTurnService` instead of `OrchestrationService`.

**Tech Stack:** TypeScript, Claude Agent SDK (`query()`), SQLite (better-sqlite3), Vitest

**Spec:** `.ultra/docs/superpowers/specs/2026-03-21-thread-coordinator-design.md`

---

### Task 1: Add `vendor_session_id` column to threads table

**Files:**
- Modify: `apps/backend/src/db/migrations.ts`

- [ ] **Step 1: Add migration 0015**

Add after the `0014_thread_seed_context` migration entry:

```typescript
{
  id: "0015_thread_vendor_session",
  sql: `ALTER TABLE threads ADD COLUMN vendor_session_id TEXT;`,
},
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/db/migrations.ts
git commit -m "feat(db): add vendor_session_id column to threads table"
```

---

### Task 2: Create `CoordinatorPromptBuilder`

**Files:**
- Create: `apps/backend/src/threads/coordinator-prompt-builder.ts`

- [ ] **Step 1: Create the prompt builder**

This module reads `seed_context_json` from a thread record and constructs the coordinator's initial prompt + any multimodal attachments.

```typescript
import type { StoredAttachment } from "../chats/attachment-storage.js"

export type CoordinatorPromptParts = {
  textPrompt: string
  attachments: StoredAttachment[]
}

const COORDINATOR_INSTRUCTIONS = `You are a thread coordinator executing an implementation plan.

## Instructions
- Use the using-git-worktrees skill to create an isolated worktree
- Execute the implementation plan using the subagent-driven-development skill
- Use test-driven-development for each task implementation
- Use verification-before-completion before claiming any task is done
- Use systematic-debugging if you encounter failures
- Do NOT re-plan. The plan is final. Execute it as written.
- Report progress as you complete each task
- If you hit a blocker, describe it clearly and wait for guidance

`

export function buildCoordinatorPrompt(seedContextJson: string): CoordinatorPromptParts {
  const seedContext = JSON.parse(seedContextJson) as {
    messages?: Array<{
      id: string
      role: string
      messageType: string
      content: string | null
      attachments?: Array<{ type: string; name: string; media_type: string; data: string }>
    }>
    artifacts?: Array<{ type: string; path: string; content: string }>
  }

  const parts: string[] = [COORDINATOR_INSTRUCTIONS]
  const allAttachments: StoredAttachment[] = []

  // Format messages
  if (seedContext.messages && seedContext.messages.length > 0) {
    parts.push("## Planning Context\n\n### Conversation\n")
    for (const msg of seedContext.messages) {
      if (!msg.content) continue
      // Skip marker messages
      if (msg.messageType?.startsWith("plan_marker") || msg.messageType === "thread_start_request") continue
      const label = msg.role === "user" ? "user" : "assistant"
      parts.push(`[${label}]: ${msg.content}\n`)

      // Collect attachments
      if (msg.attachments) {
        for (const att of msg.attachments) {
          allAttachments.push({
            type: att.type as "image" | "text",
            name: att.name,
            media_type: att.media_type,
            data: att.data,
          })
        }
      }
    }
  }

  // Format artifacts
  if (seedContext.artifacts && seedContext.artifacts.length > 0) {
    parts.push("\n### Artifacts\n")
    for (const artifact of seedContext.artifacts) {
      parts.push(`--- ${artifact.path} ---\n${artifact.content}\n`)
    }
  }

  parts.push("\nBegin execution now.")

  return {
    textPrompt: parts.join("\n"),
    attachments: allAttachments,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/threads/coordinator-prompt-builder.ts
git commit -m "feat: add CoordinatorPromptBuilder for thread seed context"
```

---

### Task 3: Create `ThreadTurnService`

**Files:**
- Create: `apps/backend/src/threads/thread-turn-service.ts`

This is the core service. It manages coordinator sessions — starting a coordinator when a thread is promoted, resuming when the user sends a message, streaming events to listeners, and updating thread state.

- [ ] **Step 1: Create ThreadTurnService**

Follow the `ChatTurnService` pattern but simpler — no turn queue (one session per thread), no claim/process loop.

```typescript
import type { ChatRuntimeAdapter, ChatRuntimeEvent, ChatRuntimeTurnResult } from "../chats/runtime/types.js"
import type { ThreadService } from "./thread-service.js"
import { buildCoordinatorPrompt } from "./coordinator-prompt-builder.js"
import type { ThreadId, ProjectId } from "@ultra/shared"

type ThreadEventListener = (event: {
  threadId: string
  eventType: string
  payload: Record<string, unknown>
}) => void

export class ThreadTurnService {
  private readonly activeThreads = new Set<ThreadId>()
  private readonly eventListeners = new Map<ThreadId, Set<ThreadEventListener>>()

  constructor(
    private readonly threadService: ThreadService,
    private readonly runtimeAdapter: ChatRuntimeAdapter,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Start the coordinator for a newly promoted thread.
   * Called from the coordinator dispatch handler.
   */
  async startCoordinator(threadId: ThreadId): Promise<void> {
    if (this.activeThreads.has(threadId)) return

    const threadDetail = this.threadService.getThread(threadId)
    const thread = threadDetail.thread

    // Read seed context from thread record
    const seedContextJson = this.threadService.getSeedContext(threadId)
    if (!seedContextJson) {
      this.updateThreadState(threadId, thread.projectId, "failed", "No seed context found")
      return
    }

    this.activeThreads.add(threadId)
    this.updateThreadState(threadId, thread.projectId, "running", null)

    try {
      const { textPrompt, attachments } = buildCoordinatorPrompt(seedContextJson)

      const result = await this.runtimeAdapter.runTurn({
        chatId: thread.sourceChatId,
        chatSessionId: `thread_${threadId}`,
        cwd: process.env.ULTRA_REPO_ROOT ?? process.cwd(),
        prompt: textPrompt,
        config: {
          provider: "claude",
          model: thread.model ?? "claude-opus-4-6",
          thinkingLevel: "high",
          permissionLevel: "full_access",
        },
        sessionType: "thread",
        continuationPrompt: null,
        seedMessages: [],
        vendorSessionId: thread.vendorSessionId ?? null,
        attachments: attachments.length > 0 ? attachments : undefined,
        onEvent: (event) => this.handleCoordinatorEvent(threadId, event),
      })

      // Store vendor session ID for resume
      if (result.vendorSessionId) {
        this.threadService.updateVendorSessionId(threadId, result.vendorSessionId)
      }

      // Coordinator finished — set awaiting_review
      this.updateThreadState(threadId, thread.projectId, "awaiting_review", null)

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateThreadState(threadId, thread.projectId, "failed", message)
    } finally {
      this.activeThreads.delete(threadId)
    }
  }

  /**
   * Resume the coordinator with a user message.
   */
  async sendMessage(threadId: ThreadId, content: string): Promise<void> {
    if (this.activeThreads.has(threadId)) {
      throw new Error("Coordinator is currently running. Wait for it to finish.")
    }

    const threadDetail = this.threadService.getThread(threadId)
    const thread = threadDetail.thread

    this.activeThreads.add(threadId)
    this.updateThreadState(threadId, thread.projectId, "running", null)

    try {
      const vendorSessionId = thread.vendorSessionId ?? null

      const result = await this.runtimeAdapter.runTurn({
        chatId: thread.sourceChatId,
        chatSessionId: `thread_${threadId}`,
        cwd: process.env.ULTRA_REPO_ROOT ?? process.cwd(),
        prompt: content,
        config: {
          provider: "claude",
          model: thread.model ?? "claude-opus-4-6",
          thinkingLevel: "high",
          permissionLevel: "full_access",
        },
        sessionType: "thread",
        continuationPrompt: null,
        seedMessages: [],
        vendorSessionId,
        onEvent: (event) => this.handleCoordinatorEvent(threadId, event),
      })

      if (result.vendorSessionId) {
        this.threadService.updateVendorSessionId(threadId, result.vendorSessionId)
      }

      this.updateThreadState(threadId, thread.projectId, "awaiting_review", null)

    } catch (error) {
      if (this.isResumeError(error)) {
        // Session expired — retry without vendor session ID
        try {
          const seedContextJson = this.threadService.getSeedContext(threadId)
          const { textPrompt, attachments } = buildCoordinatorPrompt(seedContextJson ?? "{}")

          const retryResult = await this.runtimeAdapter.runTurn({
            chatId: threadDetail.thread.sourceChatId,
            chatSessionId: `thread_${threadId}`,
            cwd: process.env.ULTRA_REPO_ROOT ?? process.cwd(),
            prompt: `${textPrompt}\n\n[User follow-up]: ${content}`,
            config: {
              provider: "claude",
              model: threadDetail.thread.model ?? "claude-opus-4-6",
              thinkingLevel: "high",
              permissionLevel: "full_access",
            },
            sessionType: "thread",
            continuationPrompt: null,
            seedMessages: [],
            vendorSessionId: null,
            attachments: attachments.length > 0 ? attachments : undefined,
            onEvent: (event) => this.handleCoordinatorEvent(threadId, event),
          })

          if (retryResult.vendorSessionId) {
            this.threadService.updateVendorSessionId(threadId, retryResult.vendorSessionId)
          }
          this.updateThreadState(threadId, threadDetail.thread.projectId, "awaiting_review", null)
        } catch (retryError) {
          const msg = retryError instanceof Error ? retryError.message : String(retryError)
          this.updateThreadState(threadId, threadDetail.thread.projectId, "failed", msg)
        }
      } else {
        const message = error instanceof Error ? error.message : String(error)
        this.updateThreadState(threadId, threadDetail.thread.projectId, "failed", message)
      }
    } finally {
      this.activeThreads.delete(threadId)
    }
  }

  isActive(threadId: ThreadId): boolean {
    return this.activeThreads.has(threadId)
  }

  addEventListener(threadId: ThreadId, listener: ThreadEventListener): () => void {
    if (!this.eventListeners.has(threadId)) {
      this.eventListeners.set(threadId, new Set())
    }
    this.eventListeners.get(threadId)!.add(listener)
    return () => this.eventListeners.get(threadId)?.delete(listener)
  }

  private handleCoordinatorEvent(threadId: ThreadId, event: ChatRuntimeEvent): void {
    const listeners = this.eventListeners.get(threadId)
    if (!listeners) return

    const mapped = {
      threadId,
      eventType: `thread.coordinator_${event.type}`,
      payload: event as unknown as Record<string, unknown>,
    }

    for (const listener of listeners) {
      try { listener(mapped) } catch { /* ignore listener errors */ }
    }
  }

  private updateThreadState(
    threadId: ThreadId,
    projectId: ProjectId,
    executionState: string,
    failureReason: string | null,
  ): void {
    this.threadService.updateExecutionState(threadId, executionState, failureReason)
  }

  private isResumeError(error: unknown): boolean {
    if (error instanceof Error && error.message.includes("resume")) return true
    const typed = error as { kind?: string }
    return typed?.kind === "resume_failed"
  }
}
```

Note: This references methods on ThreadService that don't exist yet (`getSeedContext`, `updateVendorSessionId`, `updateExecutionState`). Those are added in Task 4.

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/threads/thread-turn-service.ts
git commit -m "feat: add ThreadTurnService for coordinator session management"
```

---

### Task 4: Add helper methods to ThreadService

**Files:**
- Modify: `apps/backend/src/threads/thread-service.ts`

- [ ] **Step 1: Add `getSeedContext` method**

After `updateThreadTitle`:

```typescript
getSeedContext(threadId: ThreadId): string | null {
  const row = this.database
    .prepare("SELECT seed_context_json FROM threads WHERE id = ?")
    .get(threadId) as { seed_context_json: string | null } | undefined
  return row?.seed_context_json ?? null
}
```

- [ ] **Step 2: Add `updateVendorSessionId` method**

```typescript
updateVendorSessionId(threadId: ThreadId, vendorSessionId: string): void {
  this.database
    .prepare("UPDATE threads SET vendor_session_id = ?, updated_at = ? WHERE id = ?")
    .run(vendorSessionId, this.now(), threadId)
}
```

- [ ] **Step 3: Add `updateExecutionState` method**

```typescript
updateExecutionState(
  threadId: ThreadId,
  executionState: string,
  failureReason: string | null,
): void {
  const updates: string[] = ["execution_state = ?", "updated_at = ?"]
  const params: unknown[] = [executionState, this.now()]

  if (failureReason !== null) {
    updates.push("failure_reason = ?")
    params.push(failureReason)
  }

  if (executionState === "awaiting_review") {
    updates.push("review_state = 'ready'")
  }

  params.push(threadId)
  this.database
    .prepare(`UPDATE threads SET ${updates.join(", ")} WHERE id = ?`)
    .run(...params)
}
```

- [ ] **Step 4: Add `vendorSessionId` and `model` to thread row reading**

Find where thread rows are read and mapped to snapshots. The `vendor_session_id` column needs to be included in SELECT statements and mapped to the snapshot. Check the `readThreadRow` or equivalent function and add `vendor_session_id` to the SELECT and mapping. Also check if `model` is available — if not, the coordinator can default to `claude-opus-4-6`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/threads/thread-service.ts
git commit -m "feat: add getSeedContext, updateVendorSessionId, updateExecutionState to ThreadService"
```

---

### Task 5: Wire ThreadTurnService into index.ts and dispatch handler

**Files:**
- Modify: `apps/backend/src/index.ts`

- [ ] **Step 1: Import and construct ThreadTurnService**

Add import:
```typescript
import { ThreadTurnService } from "./threads/thread-turn-service.js"
```

After `chatTurnService` construction, add:
```typescript
const threadTurnService = new ThreadTurnService(
  threadService,
  new ClaudeChatRuntimeAdapter({
    pathToClaudeCodeExecutable: "claude",
  }),
)
```

- [ ] **Step 2: Update coordinator dispatch handler**

Replace the existing `startThread` handler (lines ~146-154) with:

```typescript
startThread: ({ input, thread }) => {
  void threadTurnService.startCoordinator(thread.thread.id)
},
```

This replaces the `orchestrationService.startThread()` call. The coordinator now starts via `ThreadTurnService` which calls `query()` directly.

- [ ] **Step 3: Update `sendThreadMessage` handler**

Replace:
```typescript
sendThreadMessage: (input) =>
  coordinatorService.sendThreadMessage({
    ...input,
    threadId: input.threadId,
  }),
```

With:
```typescript
sendThreadMessage: (input) => {
  void threadTurnService.sendMessage(input.threadId, input.contentMarkdown)
},
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat: wire ThreadTurnService as coordinator dispatch handler"
```

---

### Task 6: Update IPC router for coordinator message handling

**Files:**
- Modify: `apps/backend/src/ipc/router.ts`

- [ ] **Step 1: Find existing `threads.send_message` handler and verify it routes through the dispatch handler**

The existing handler at ~line 881 calls `threadService.sendMessage()` which calls `coordinatorDispatchHandler.sendThreadMessage()`. This should already work with the updated dispatch handler from Task 5. Verify the flow:

`threads.send_message` IPC → `threadService.sendMessage()` → `coordinatorDispatchHandler.sendThreadMessage()` → `threadTurnService.sendMessage()`

If this chain works, no router changes needed. If `threadService.sendMessage()` does additional validation or formatting, that's fine — it will call through to the coordinator.

- [ ] **Step 2: Commit (if changes were needed)**

```bash
git add apps/backend/src/ipc/router.ts
git commit -m "feat: verify threads.send_message routes through coordinator turn service"
```

---

### Task 7: Integration test — promote and verify coordinator starts

- [ ] **Step 1: Start the app**

```bash
cd apps/desktop && npm run dev
```

- [ ] **Step 2: Plan and promote**

1. Start a new chat, plan something simple (e.g. "add a hello world function to a new file")
2. Let the brainstorming and writing-plans skills complete
3. Click Promote to Thread

- [ ] **Step 3: Verify coordinator started**

Check the terminal logs for:
- Thread created log
- Coordinator query() starting
- Streaming events flowing

Check the database:
```bash
sqlite3 ~/Library/Application\ Support/@ultra/desktop/data/ultra.db \
  "SELECT id, execution_state, vendor_session_id FROM threads ORDER BY created_at DESC LIMIT 1;"
```

Expected: `execution_state` should transition from `queued` → `starting` → `running` → `awaiting_review` (or `failed` if something went wrong).

- [ ] **Step 4: Verify thread state updates**

After the coordinator finishes (or fails), check:
- `execution_state` is `awaiting_review` or `failed`
- `vendor_session_id` is populated (for session resume)
- `failure_reason` is set if failed
