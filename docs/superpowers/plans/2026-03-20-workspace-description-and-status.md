# Workspace Description & Chat Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-generated workspace description and a turn status indicator to each chat row in the sidebar.

**Architecture:** Backend-driven. After each successful turn, `ChatTurnService` fires an async summary generation call to a lightweight LLM (Haiku/small Codex). Turn status is derived at query time from the most recent turn state. Both fields flow through existing `ChatSummary` contracts to the frontend.

**Tech Stack:** SQLite (migration), Zod (contracts), vitest (tests), React (ChatRow), plain CSS (BEM), Claude/Codex CLI (summary generation)

**Spec:** `docs/superpowers/specs/2026-03-20-workspace-description-and-chat-status-design.md`

**Tickets:** ULR-96 (workspace description), ULR-97 (turn status indicator)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/backend/src/db/migrations.ts` | Modify | Add migration 0012 for `workspace_description` column |
| `packages/shared/src/contracts/chats.ts` | Modify | Add `workspaceDescription` and `turnStatus` to schemas |
| `apps/backend/src/chats/chat-service.ts` | Modify | Add `workspace_description` to queries, `ChatRow`, mapping, and update method |
| `apps/backend/src/chats/chat-turn-service.ts` | Modify | Hook summary generation after successful turns; add turn status derivation |
| `apps/backend/src/chats/workspace-summary.ts` | Create | Summary generation prompt + LLM call logic |
| `apps/backend/src/chats/workspace-summary.test.ts` | Create | Tests for summary prompt building and description update flow |
| `apps/backend/src/chats/chat-service.test.ts` | Modify | Add tests for `updateWorkspaceDescription` and `getTurnStatus` |
| `apps/desktop/src/renderer/src/sidebar/ChatRow.tsx` | Modify | Render description subtitle and status dot |
| `apps/desktop/src/renderer/src/styles/app.css` | Modify | Add CSS for description and status indicator |

---

### Task 1: Database Migration — Add `workspace_description` Column

**Files:**
- Modify: `apps/backend/src/db/migrations.ts:635` (append to `DATABASE_MIGRATIONS` array)

- [ ] **Step 1: Add migration 0012**

In `apps/backend/src/db/migrations.ts`, add a new entry at the end of the `DATABASE_MIGRATIONS` array (before the closing `]` on line 635):

```typescript
  {
    id: "0012_workspace_description",
    sql: `
      ALTER TABLE chats ADD COLUMN workspace_description TEXT;
    `,
  },
```

- [ ] **Step 2: Verify the app boots with the new migration**

Run: `cd apps/backend && npx vitest run src/db/ --reporter=verbose 2>&1 | tail -20`

Expected: All existing database tests pass. The migration applies cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/migrations.ts
git commit -m "feat(db): add workspace_description column to chats table (ULR-96)"
```

---

### Task 2: Shared Contracts — Add `workspaceDescription` and `turnStatus` Fields

**Files:**
- Modify: `packages/shared/src/contracts/chats.ts:19-37` (schema definitions)
- Modify: `packages/shared/src/contracts/chats.ts:414-416` (type exports)

- [ ] **Step 1: Add `turnStatus` schema**

After the existing `chatPermissionLevelSchema` (line 16), add:

```typescript
export const chatSidebarTurnStatusSchema = z.enum([
  "running",
  "waiting_for_input",
  "error",
])
```

Note: This is named `chatSidebarTurnStatusSchema` to avoid collision with the existing `chatTurnStatusSchema` (~line 80) which tracks the turn lifecycle (`queued`, `running`, `succeeded`, `failed`, `canceled`).

- [ ] **Step 2: Add fields to `chatSnapshotSchema`**

In `chatSnapshotSchema` (lines 19-35), add two new fields before the closing `})`:

```typescript
  workspaceDescription: z.string().nullable(),
  turnStatus: chatSidebarTurnStatusSchema.nullable(),
```

Since `chatSummarySchema` is an alias for `chatSnapshotSchema` (line 37), both types get the new fields automatically.

- [ ] **Step 3: Verify types compile**

Run: `cd packages/shared && npx tsc --noEmit`

Expected: Compilation errors in backend/desktop where `ChatSnapshot` objects are constructed without the new fields. This is expected — we'll fix those in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/contracts/chats.ts
git commit -m "feat(contracts): add workspaceDescription and turnStatus to chat schemas (ULR-96, ULR-97)"
```

---

### Task 3: Backend Chat Service — Wire `workspace_description` Through Queries

**Files:**
- Modify: `apps/backend/src/chats/chat-service.ts:15-31` (`ChatRow` type)
- Modify: `apps/backend/src/chats/chat-service.ts:143-161` (`CHAT_SELECT_COLUMNS`)
- Modify: `apps/backend/src/chats/chat-service.ts:180-198` (`mapChatRow`)
- Test: `apps/backend/src/chats/chat-service.test.ts`

- [ ] **Step 1: Write failing test for `workspace_description` in chat response**

In `apps/backend/src/chats/chat-service.test.ts`, add a test:

```typescript
it("returns workspaceDescription as null for new chats", () => {
  const chat = chatService.create(projectId)
  expect(chat.workspaceDescription).toBeNull()
})

it("returns workspaceDescription after update", () => {
  const chat = chatService.create(projectId)
  chatService.updateWorkspaceDescription(chat.id, "ULR-93: Fixing archived chat persistence")
  const updated = chatService.get(chat.id)
  expect(updated.workspaceDescription).toBe("ULR-93: Fixing archived chat persistence")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/chats/chat-service.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — `workspaceDescription` not present on returned object, `updateWorkspaceDescription` method does not exist.

- [ ] **Step 3: Add `workspace_description` to `ChatRow` type**

In `chat-service.ts`, add to the `ChatRow` type (after line 29):

```typescript
  workspace_description: string | null
```

- [ ] **Step 4: Add `workspace_description` to `CHAT_SELECT_COLUMNS`**

In the `CHAT_SELECT_COLUMNS` constant (line 143-161), add `workspace_description` to the SELECT list:

```typescript
const CHAT_SELECT_COLUMNS = `
  SELECT
    id,
    project_id,
    title,
    status,
    provider,
    model,
    thinking_level,
    permission_level,
    is_pinned,
    pinned_at,
    archived_at,
    last_compacted_at,
    current_session_id,
    workspace_description,
    created_at,
    updated_at
  FROM chats
`
```

- [ ] **Step 5: Add mapping in `mapChatRow`**

In the `mapChatRow` function (lines 180-198), add the new field. Also add a placeholder `turnStatus: null` — it will be computed properly in Task 4:

```typescript
function mapChatRow(row: ChatRow): ChatSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    provider: row.provider,
    model: row.model,
    thinkingLevel: row.thinking_level,
    permissionLevel: row.permission_level,
    isPinned: row.is_pinned === 1,
    pinnedAt: row.pinned_at,
    archivedAt: row.archived_at,
    lastCompactedAt: row.last_compacted_at,
    currentSessionId: row.current_session_id,
    workspaceDescription: row.workspace_description,
    turnStatus: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
```

- [ ] **Step 6: Add `updateWorkspaceDescription` method**

Add a new method to the `ChatService` class:

```typescript
updateWorkspaceDescription(chatId: ChatId, description: string): void {
  const timestamp = this.now()
  this.database
    .prepare(
      "UPDATE chats SET workspace_description = ?, updated_at = ? WHERE id = ?",
    )
    .run(description, timestamp, chatId)
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/chats/chat-service.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/chats/chat-service.ts apps/backend/src/chats/chat-service.test.ts
git commit -m "feat(chat-service): add workspace_description to queries and mapping (ULR-96)"
```

---

### Task 4: Backend — Turn Status Derivation

**Files:**
- Modify: `apps/backend/src/chats/chat-turn-service.ts`
- Modify: `apps/backend/src/chats/chat-service.ts` (update `list()` and `get()` to include turn status)
- Test: `apps/backend/src/chats/chat-service.test.ts`

The turn status is derived by querying the `chat_turns` table for each chat. The priority order:
1. Active turn (queued/running) → `"running"`
2. Most recent turn failed → `"error"`
3. Otherwise → `"waiting_for_input"`
4. No turns → `null`

- [ ] **Step 1: Write failing test for turn status derivation**

In `apps/backend/src/chats/chat-service.test.ts`, add:

```typescript
it("returns turnStatus as null for chat with no turns", () => {
  const chat = chatService.create(projectId)
  expect(chat.turnStatus).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/chats/chat-service.test.ts -t "turnStatus" --reporter=verbose 2>&1 | tail -10`

Expected: FAIL — `turnStatus` is hardcoded to `null` from Task 3, but we need to verify the test infrastructure works.

Note: This test actually passes since we set `turnStatus: null` in `mapChatRow`. We need a test that exercises the computed behavior. Add tests that create turns and verify the status changes — this requires `ChatTurnService`. If the existing test setup doesn't include `ChatTurnService`, add the derivation logic as a standalone function that can be tested independently.

- [ ] **Step 3: Add `deriveTurnStatus` helper to `chat-service.ts`**

Add a method to `ChatService` that queries the turn status for a single chat:

```typescript
deriveTurnStatus(chatId: ChatId): "running" | "waiting_for_input" | "error" | null {
  // Check for active turns first
  const activeTurn = this.database
    .prepare(
      "SELECT turn_id FROM chat_turns WHERE chat_id = ? AND status IN ('queued', 'running') LIMIT 1",
    )
    .get(chatId)

  if (activeTurn) return "running"

  // Check most recent turn
  const latestTurn = this.database
    .prepare(
      "SELECT status FROM chat_turns WHERE chat_id = ? ORDER BY started_at DESC LIMIT 1",
    )
    .get(chatId) as { status: string } | undefined

  if (!latestTurn) return null
  if (latestTurn.status === "failed") return "error"
  return "waiting_for_input"
}
```

- [ ] **Step 4: Update `list()` and `get()` to compute turn status**

In the `list()` method (~line 330), after mapping rows, compute turn status for each chat:

```typescript
list(projectId: ProjectId, includeArchived: boolean = false): ChatsListResult {
  this.assertProjectExists(projectId)

  const rows = this.database
    .prepare(
      `
        ${CHAT_SELECT_COLUMNS}
        WHERE project_id = ?${includeArchived ? "" : " AND status = 'active'"}
        ORDER BY is_pinned DESC, updated_at DESC
      `,
    )
    .all(projectId) as ChatRow[]

  return {
    chats: rows.map((row) => {
      const chat = mapChatRow(row)
      chat.turnStatus = this.deriveTurnStatus(chat.id)
      return chat satisfies ChatSummary
    }),
  }
}
```

Similarly update `get()` (~line 348):

```typescript
get(chatId: ChatId): ChatSnapshot {
  const row = readChatRow(
    this.database
      .prepare(`${CHAT_SELECT_COLUMNS} WHERE id = ?`)
      .get(chatId),
  )

  if (!row) {
    throw new IpcProtocolError("not_found", `Chat ${chatId} not found.`)
  }

  const chat = mapChatRow(row)
  chat.turnStatus = this.deriveTurnStatus(chatId)
  return chat
}
```

- [ ] **Step 5: Write tests for turn status derivation**

Add tests in `chat-service.test.ts` that directly insert turn rows and verify derivation:

```typescript
describe("deriveTurnStatus", () => {
  it("returns null when no turns exist", () => {
    const chat = chatService.create(projectId)
    expect(chatService.deriveTurnStatus(chat.id)).toBeNull()
  })

  it("returns 'running' when a turn is queued", () => {
    const chat = chatService.create(projectId)
    // Insert a queued turn directly
    db.prepare(
      "INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 'claude', 'haiku', ?, ?)",
    ).run("turn_1", chat.id, chat.currentSessionId, "msg_1", new Date().toISOString(), new Date().toISOString())
    expect(chatService.deriveTurnStatus(chat.id)).toBe("running")
  })

  it("returns 'waiting_for_input' when last turn succeeded", () => {
    const chat = chatService.create(projectId)
    db.prepare(
      "INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, 'succeeded', 'claude', 'haiku', ?, ?, ?)",
    ).run("turn_1", chat.id, chat.currentSessionId, "msg_1", new Date().toISOString(), new Date().toISOString(), new Date().toISOString())
    expect(chatService.deriveTurnStatus(chat.id)).toBe("waiting_for_input")
  })

  it("returns 'error' when last turn failed", () => {
    const chat = chatService.create(projectId)
    db.prepare(
      "INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at) VALUES (?, ?, ?, ?, 'failed', 'claude', 'haiku', ?, ?)",
    ).run("turn_1", chat.id, chat.currentSessionId, "msg_1", new Date().toISOString(), new Date().toISOString())
    expect(chatService.deriveTurnStatus(chat.id)).toBe("error")
  })

  it("returns 'running' even when previous turn failed (active turn takes priority)", () => {
    const chat = chatService.create(projectId)
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at) VALUES (?, ?, ?, ?, 'failed', 'claude', 'haiku', ?, ?)",
    ).run("turn_1", chat.id, chat.currentSessionId, "msg_1", now, now)
    db.prepare(
      "INSERT INTO chat_turns (turn_id, chat_id, session_id, user_message_id, status, provider, model, started_at, updated_at) VALUES (?, ?, ?, ?, 'running', 'claude', 'haiku', ?, ?)",
    ).run("turn_2", chat.id, chat.currentSessionId, "msg_2", now, now)
    expect(chatService.deriveTurnStatus(chat.id)).toBe("running")
  })
})
```

Note: These tests insert turns directly into the DB since `ChatTurnService` may not be available in the `ChatService` test setup. Adapt the insert statements to match any foreign key constraints — you may need to insert a `chat_messages` row first for `user_message_id`, and ensure `currentSessionId` is set on the chat (create a session first if needed). Check the existing test patterns in `chat-service.test.ts` for how the test DB is set up.

- [ ] **Step 6: Run tests**

Run: `cd apps/backend && npx vitest run src/chats/chat-service.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/chats/chat-service.ts apps/backend/src/chats/chat-service.test.ts
git commit -m "feat(chat-service): derive turn status from chat_turns table (ULR-97)"
```

---

### Task 5: Backend — Workspace Summary Generation Module

**Files:**
- Create: `apps/backend/src/chats/workspace-summary.ts`
- Create: `apps/backend/src/chats/workspace-summary.test.ts`

This module builds the summary prompt and handles the LLM call. It's kept separate from the turn service so it can be tested independently.

- [ ] **Step 1: Write failing test for prompt building**

Create `apps/backend/src/chats/workspace-summary.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

import { buildSummaryPrompt } from "./workspace-summary.js"

describe("buildSummaryPrompt", () => {
  it("builds prompt with no current description", () => {
    const prompt = buildSummaryPrompt(null, [
      { role: "user", content: "Fix the copy paste bug in our Electron app" },
      { role: "assistant", content: "I'll investigate the app menu..." },
    ])
    expect(prompt).toContain("None yet")
    expect(prompt).toContain("Fix the copy paste bug")
  })

  it("builds prompt with existing description", () => {
    const prompt = buildSummaryPrompt(
      "Fixing copy/paste in Electron app",
      [
        { role: "user", content: "Now add an Edit menu" },
        { role: "assistant", content: "Done, added the Edit menu." },
      ],
    )
    expect(prompt).toContain("Fixing copy/paste in Electron app")
    expect(prompt).toContain("Now add an Edit menu")
  })

  it("truncates messages that are too long", () => {
    const longContent = "x".repeat(2000)
    const prompt = buildSummaryPrompt(null, [
      { role: "user", content: longContent },
    ])
    expect(prompt.length).toBeLessThan(3000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/chats/workspace-summary.test.ts --reporter=verbose 2>&1 | tail -10`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `workspace-summary.ts`**

Create `apps/backend/src/chats/workspace-summary.ts`:

```typescript
type SummaryMessage = {
  role: string
  content: string
}

const MAX_MESSAGE_LENGTH = 500
const SUMMARY_SYSTEM_PROMPT = `You are generating a workspace description for a coding session sidebar.
Output ONLY a single line, max 80 characters. No quotes, no explanation.
Include ticket number if referenced (e.g., "ULR-93: ...").
Focus on the high-level goal, not individual steps.
Only change the description if the session's focus has meaningfully shifted.
If the focus hasn't changed, return the current description unchanged.`

export function buildSummaryPrompt(
  currentDescription: string | null,
  recentMessages: SummaryMessage[],
): string {
  const truncated = recentMessages.map((m) => ({
    role: m.role,
    content:
      m.content.length > MAX_MESSAGE_LENGTH
        ? m.content.slice(0, MAX_MESSAGE_LENGTH) + "..."
        : m.content,
  }))

  const messagesText = truncated
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n")

  return `Current description: ${currentDescription ?? "None yet"}

Recent messages:
${messagesText}

Write the workspace description now:`
}

export function getSystemPrompt(): string {
  return SUMMARY_SYSTEM_PROMPT
}

export function selectSummaryModel(chatProvider: "codex" | "claude"): {
  provider: "codex" | "claude"
  model: string
} {
  if (chatProvider === "claude") {
    return { provider: "claude", model: "claude-haiku-4-5-20251001" }
  }
  return { provider: "codex", model: "codex-mini-latest" }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/chats/workspace-summary.test.ts --reporter=verbose 2>&1 | tail -10`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/chats/workspace-summary.ts apps/backend/src/chats/workspace-summary.test.ts
git commit -m "feat: add workspace summary prompt builder and model selection (ULR-96)"
```

---

### Task 6: Backend — Hook Summary Generation Into Turn Completion

**Files:**
- Modify: `apps/backend/src/chats/chat-turn-service.ts:931-938` (after `finalizeSucceededTurn`)

The summary generation call happens after the turn is finalized and events are notified. It's fire-and-forget — errors are silently caught. The LLM call uses the same subprocess/CLI pattern as the existing runtime adapters.

- [ ] **Step 1: Add async summary generation trigger**

In `chat-turn-service.ts`, in the `executeClaimedTurn` method (line 903), after the successful turn notification (line 931-938), add the fire-and-forget summary call:

```typescript
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

      // Fire-and-forget workspace description update
      this.updateWorkspaceDescription(chatId).catch(() => {
        // Silently ignore summary generation failures
      })
    } catch (error) {
```

- [ ] **Step 2: Implement `updateWorkspaceDescription` method on `ChatTurnService`**

Add to `ChatTurnService`:

```typescript
private async updateWorkspaceDescription(chatId: ChatId): Promise<void> {
  const chat = this.chatService.get(chatId)
  const messages = this.chatService.listMessages(chatId)

  // Take last 10 messages (5 turns = 5 user + 5 assistant)
  const recentMessages = messages.slice(-10).map((m) => ({
    role: m.role,
    content: m.contentMarkdown ?? "",
  }))

  if (recentMessages.length === 0) return

  const { provider, model } = selectSummaryModel(chat.provider)
  const systemPrompt = getSystemPrompt()
  const userPrompt = buildSummaryPrompt(
    chat.workspaceDescription,
    recentMessages,
  )

  // Use the runtime registry to make a lightweight LLM call
  const adapter = this.runtimeRegistry.getAdapter(provider)
  const result = await adapter.runTurn({
    model,
    prompt: userPrompt,
    systemPrompt,
    // Minimal config for a summary call
    thinkingLevel: "none",
    permissionLevel: "supervised",
    cwd: "",
    vendorSessionId: null,
    seedMessages: [],
    continuationPrompt: null,
    signal: AbortSignal.timeout(15_000), // 15s timeout
  })

  const description = result.finalText.trim().slice(0, 120)
  if (description.length > 0) {
    this.chatService.updateWorkspaceDescription(chatId, description)
  }
}
```

**Important:** The exact shape of `adapter.runTurn()` parameters depends on the `ChatRuntimeTurnRequest` type defined in `apps/backend/src/chats/runtime/types.ts`. Check that type and adapt the call accordingly. The key requirements are: use the lightweight model, pass a short prompt, set a timeout, and extract `result.finalText`.

If the runtime adapter interface doesn't support a simple prompt-in/text-out call (it may require a cwd, seed messages, etc.), consider using a direct subprocess call to the Claude/Codex CLI instead:

```typescript
// Alternative: direct CLI call for Claude
import { execFile } from "node:child_process"
import { promisify } from "node:util"
const execFileAsync = promisify(execFile)

const { stdout } = await execFileAsync("claude", [
  "-p", userPrompt,
  "--model", model,
  "--no-input",
  "--output-format", "text",
], { timeout: 15_000 })
```

Adapt based on how the existing adapters work. The import for `buildSummaryPrompt`, `getSystemPrompt`, and `selectSummaryModel` comes from `./workspace-summary.js`.

- [ ] **Step 3: Add imports**

At the top of `chat-turn-service.ts`, add:

```typescript
import {
  buildSummaryPrompt,
  getSystemPrompt,
  selectSummaryModel,
} from "./workspace-summary.js"
```

- [ ] **Step 4: Run existing turn service tests to verify no regressions**

Run: `cd apps/backend && npx vitest run src/chats/chat-turn-service.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: PASS — existing tests should not be affected by the fire-and-forget call.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/chats/chat-turn-service.ts
git commit -m "feat(turn-service): trigger workspace description generation after successful turns (ULR-96)"
```

---

### Task 7: Frontend — Update ChatRow to Display Description and Status

**Files:**
- Modify: `apps/desktop/src/renderer/src/sidebar/ChatRow.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css:1408-1483`

- [ ] **Step 1: Update ChatRow component to render description and status**

In `ChatRow.tsx`, update the normal (non-editing) return block (lines 84-98):

```tsx
  const statusConfig = chat.turnStatus
    ? {
        running: { color: "#a6e3a1", label: "Running" },
        waiting_for_input: { color: "#89b4fa", label: "Waiting for input" },
        error: { color: "#f38ba8", label: "Error" },
      }[chat.turnStatus]
    : null

  return (
    <button
      className={`chat-row ${isActive ? "chat-row--active" : ""} ${chat.isPinned ? "chat-row--pinned" : ""}`}
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="chat-row__header">
        <span className="chat-row__title">{chat.title}</span>
        <span className="chat-row__time">
          {formatRelativeTime(chat.updatedAt)}
        </span>
      </div>
      {chat.workspaceDescription && (
        <span className="chat-row__description">
          {chat.workspaceDescription}
        </span>
      )}
      {statusConfig && (
        <span
          className="chat-row__status"
          style={{ color: statusConfig.color }}
        >
          <span
            className="chat-row__status-dot"
            style={{ backgroundColor: statusConfig.color }}
          />
          {statusConfig.label}
        </span>
      )}
    </button>
  )
```

Note: The layout changes from a single-line flex row to a vertical stack. The `chat-row__header` div wraps the title and timestamp on the same line.

- [ ] **Step 2: Update editing mode similarly**

In the editing return block (lines 53-81), the rename input stays as-is. No description or status in editing mode.

- [ ] **Step 3: Add CSS styles**

In `apps/desktop/src/renderer/src/styles/app.css`, update the `.chat-row` styles and add new ones. Replace the existing `.chat-row` block (lines 1408-1424):

```css
.chat-row {
  appearance: none;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
  gap: 2px;
}
```

Add after existing `.chat-row__time` styles (after line 1483):

```css
.chat-row__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 8px;
}

.chat-row__description {
  color: var(--text-muted);
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.chat-row__status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.65rem;
}

.chat-row__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: PASS — `ChatSummary` now includes `workspaceDescription` and `turnStatus`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/sidebar/ChatRow.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "feat(ui): render workspace description and status indicator in chat rows (ULR-96, ULR-97)"
```

---

### Task 8: Frontend — Update Sidebar Turn Status From Turn Events

**Files:**
- Modify: `apps/desktop/src/renderer/src/state/app-store.tsx` (add action to update turn status)
- Modify: `apps/desktop/src/renderer/src/chats/chat-message-workflows.ts` (update status on turn events)

The frontend already subscribes to `chats.turn_events`. We need to update the chat's `turnStatus` in the store when turn events arrive, so the status dot updates in real-time without refetching.

- [ ] **Step 1: Add `updateChatTurnStatus` action to store**

In `app-store.tsx`, add a new action that updates just the `turnStatus` field on a chat in the sidebar:

```typescript
updateChatTurnStatus: (chatId: string, turnStatus: ChatSummary["turnStatus"]) =>
  set((state) => {
    const updatedByProject = { ...state.sidebar.chatsByProjectId }
    for (const [projectId, chats] of Object.entries(updatedByProject)) {
      const index = chats.findIndex((c) => c.id === chatId)
      if (index >= 0) {
        updatedByProject[projectId] = chats.map((c) =>
          c.id === chatId ? { ...c, turnStatus } : c,
        )
        break
      }
    }
    return {
      ...state,
      sidebar: { ...state.sidebar, chatsByProjectId: updatedByProject },
    }
  }),
```

- [ ] **Step 2: Update turn event handler to set status**

In `chat-message-workflows.ts`, find where `chats.turn_events` subscription events are handled. When a `chat.turn_started` or `chat.turn_queued` event arrives, set the chat's turn status to `"running"`. When `chat.turn_completed` arrives, set it to `"waiting_for_input"`. When `chat.turn_failed` arrives, set it to `"error"`.

The exact event types to check are in the `eventType` field of the turn event payload. Map them:

```typescript
// Inside the turn events subscription handler:
const eventType = event.payload.eventType
if (eventType === "chat.turn_queued" || eventType === "chat.turn_started") {
  actions.updateChatTurnStatus(chatId, "running")
} else if (eventType === "chat.turn_completed") {
  actions.updateChatTurnStatus(chatId, "waiting_for_input")
} else if (eventType === "chat.turn_failed") {
  actions.updateChatTurnStatus(chatId, "error")
}
```

Adapt the field names based on the actual event envelope structure in `chat-message-workflows.ts`.

- [ ] **Step 3: Run type checks**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/state/app-store.tsx apps/desktop/src/renderer/src/chats/chat-message-workflows.ts
git commit -m "feat(ui): update turn status in real-time from turn events (ULR-97)"
```

---

### Task 9: Full Integration Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd apps/backend && npx vitest run --reporter=verbose 2>&1 | tail -30`

Expected: PASS

- [ ] **Step 2: Run all frontend type checks**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: PASS

- [ ] **Step 3: Run shared package type checks**

Run: `cd packages/shared && npx tsc --noEmit`

Expected: PASS

- [ ] **Step 4: Visual smoke test**

Start the app and verify:
- New chats show only title + timestamp (no description, no status dot)
- After sending a message and receiving a response, the status dot appears (green while running, blue after completion)
- After the first successful turn, a workspace description appears below the title
- The description stays stable across follow-up messages in the same topic
- Sending a new message clears the error state (if previously errored)

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: integration cleanup for workspace description and status (ULR-96, ULR-97)"
```
