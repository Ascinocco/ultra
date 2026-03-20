# Workspace Description & Chat Status Indicator

**Date:** 2026-03-20
**Status:** Draft
**Related tickets:** ULR-95

## Summary

Add two new pieces of context to each chat row in the sidebar: a **workspace description** (LLM-generated summary of what the session is actively working on) and a **turn status indicator** (Running / Waiting for input / Error). Together these transform the sidebar from a flat list of chat names into an at-a-glance dashboard of session activity.

## Motivation

When running multiple chats across projects, the chat title alone doesn't communicate what each session is doing. Users have to click into a chat to remember its context. A concise, auto-generated description line (e.g., "ULR-93: Fixing archived chat persistence in chat-service") gives immediate awareness without switching context. The status indicator adds activity state — is the LLM still working, or is it my turn?

Inspiration: cmux's sidebar, which shows title, description, and status per session — adapted here to work within Ultra's project-folder nesting.

## Design

### Data Model

**Database migration** — Add one column to the `chats` table:

```sql
ALTER TABLE chats ADD COLUMN workspace_description TEXT;
```

Nullable. Null means no description has been generated yet (new chat, no completed turns).

**Shared contracts** — Extend `ChatSummary` and `ChatSnapshot` in `packages/shared/src/contracts/chats.ts`:

- `workspaceDescription: string | null` — the LLM-generated summary
- `turnStatus: "running" | "waiting_for_input" | "error" | null` — computed at query time, not persisted

Both `ChatSummary` and `ChatSnapshot` currently share the same schema and should remain unified — both get both new fields.

`turnStatus` is derived from the most recent turn's state, not stored as a column.

### Summary Generation Flow

**Trigger:** After `ChatTurnService` processes a successful turn (status = "succeeded"), it fires summary generation as an async fire-and-forget call. Failed and canceled turns do not trigger updates.

**Input to the LLM:**

- Current `workspace_description` value (or null if first time)
- Last 5 messages (user + assistant) from the chat history

**Provider selection:**

- Chat provider is `claude` → use Haiku
- Chat provider is `codex` → use the smallest available Codex model (concrete model ID to be determined during implementation planning based on what's available)

The provider matches the chat's ecosystem but always uses the lightweight variant. This is a structured extraction task, not a reasoning task.

**Prompt structure:**

```
You are generating a workspace description for a coding session sidebar.

Current description: {current_description or "None yet"}

Recent messages:
{last 5 messages, role-labeled}

Rules:
- Output a single line, max ~80 characters
- Include ticket number if one is referenced (e.g., "ULR-93: ...")
- Focus on the high-level goal, not individual steps
- Only change the description if the session's focus has meaningfully shifted
- If the focus hasn't changed, return the current description unchanged
- If this is the first description, derive it from what the user is working on
```

**Stability:** The prompt is anchored to the current description and explicitly instructs the LLM to only update when the session's focus has meaningfully shifted. This prevents the description from bouncing with every minor step within a larger task.

**Error handling:** If the summary LLM call fails, silently ignore it. The description stays as-is (or remains null). No retries — the next successful turn will trigger another attempt naturally.

**Write-back:** On success, update `chats.workspace_description` in the database and push the updated `ChatSummary` to the frontend via the existing event/subscription channel.

### Turn Status Derivation

No new persistence needed. When building a `ChatSummary` response:

1. Check if there's an active turn for the chat (status = "queued" or "running") → `"running"`
2. Check if the most recent turn has status "failed" → `"error"`
3. Otherwise → `"waiting_for_input"`
4. Brand new chat with no turns → `null` (no status dot shown)

Note: These checks are ordered by priority. When a user sends a new message after an error, the new turn's "queued"/"running" state (check 1) takes priority over the previous turn's "failed" state (check 2), so the error status clears automatically.

**Real-time updates:** The frontend already subscribes to turn events via `ChatTurnEventListener`. When a turn starts or completes, the frontend receives the event and updates the status dot locally without re-fetching the full chat list:

- User sends a message → turn starts → green dot, "Running"
- Turn completes → blue dot, "Waiting for input"
- Turn fails → red dot, "Error"

### Frontend — ChatRow Layout

The chat row in the sidebar extends to show three layers of information:

```
[Title]                              [timestamp]
[workspace description - muted, single line, ellipsis truncated]
[● status label]
```

**States:**

- **Full row:** Title + description + status (chat with completed turns)
- **New chat:** Title + timestamp only (no description, no status dot). The row collapses to current layout — no empty space reserved.
- **Description, no active status:** Title + description + status (defaults to "Waiting for input" after first turn)

**Status indicator colors:**

| Status | Color | Label |
|--------|-------|-------|
| Running | Green (#a6e3a1) | Running |
| Waiting for input | Blue (#89b4fa) | Waiting for input |
| Error | Red (#f38ba8) | Error |

### Frontend — State Management

The Zustand store already holds `ChatSummary[]` per project. The new fields flow through naturally as part of the `ChatSummary` contract. Two update paths:

1. **Description updates:** Backend pushes updated chat summary after the LLM generates a new description → frontend calls `upsertChat()`
2. **Status updates:** Frontend reacts to turn events it already receives and updates the local `turnStatus` on the chat entry in the store

No new IPC subscriptions or query endpoints needed.

### Backend — IPC Changes

The `chats.list` and `chats.get` responses already return full `ChatSummary`/`ChatSnapshot` objects. Adding `workspaceDescription` and `turnStatus` to these contracts means the data flows to the frontend automatically.

The turn status computation happens in the service layer when mapping database rows to response objects — it queries the turns table for the chat's most recent turn state.

## Scope

### In scope

- `workspace_description` column and database migration
- `workspaceDescription` and `turnStatus` fields on shared contracts
- Backend summary generation after successful turns (fire-and-forget)
- Provider-matched lightweight LLM selection (Haiku for Claude chats, small model for Codex chats)
- Turn status derivation in chat list/get responses
- ChatRow UI update (description subtitle + status dot)
- Frontend handling of description updates and turn status from existing events

### Out of scope

- User-editable descriptions
- Summary generation settings or configuration
- Description displayed anywhere other than the sidebar
- Persisting turn status to the database
- Chat activity notifications and badges (covered by ULR-79)
