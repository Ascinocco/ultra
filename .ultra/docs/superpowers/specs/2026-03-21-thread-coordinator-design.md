# Thread Coordinator — Design Spec

**Ticket:** ULR-84
**Date:** 2026-03-21
**Status:** Approved

## Goal

Wire the thread coordinator end-to-end: when a chat is promoted to a thread, a separate Claude SDK session receives the seed context and begins autonomous plan execution using subagent-driven-development.

## Coordinator Lifecycle

1. User promotes chat to thread → `promoteToThread` creates thread record with `seed_context_json`
2. Coordinator dispatch fires immediately — spawns a `query()` session
3. Coordinator creates a worktree (via using-git-worktrees skill), reads the plan from seed context, executes tasks autonomously
4. Streaming events flow to the thread detail UI in real-time
5. When `query()` ends, vendor session ID stored on thread record for resumption
6. Thread state updates based on outcome (see Thread States below)

User can send messages via the thread detail pane → triggers `query()` with `resume: vendorSessionId` → coordinator picks up with new context.

## Thread States (Two-Axis Model)

The codebase uses two separate state axes. The coordinator sets these based on execution outcome:

### Execution State (`executionState`)

| State | Set By | When |
|-------|--------|------|
| `queued` | System | Thread created, coordinator not yet started |
| `starting` | System | Coordinator session spawning |
| `running` | Coordinator | Actively executing tasks |
| `blocked` | Coordinator | Hit a blocker, needs user guidance |
| `awaiting_review` | Coordinator | Finished plan execution, user should review |
| `completed` | User | Explicitly marked done (manual action only) |
| `failed` | System | Coordinator crashed or unrecoverable error |

### Review State (`reviewState`)

| State | Set By | When |
|-------|--------|------|
| `not_ready` | System | Default — work not yet complete |
| `ready` | Coordinator | Execution finished, work ready for review |
| `in_review` | User | User is actively reviewing |
| `changes_requested` | User | User sent change feedback |
| `approved` | User | User approved the work |

**Coordinator sets:** `executionState` to `running` / `blocked` / `awaiting_review` and `reviewState` to `ready` when done.

**User sets:** `executionState` to `completed`, `reviewState` to `changes_requested` / `approved`.

**System sets:** `executionState` to `failed` on crash.

## Coordinator Session Architecture

- Completely separate `query()` session from the main chat — different context window, different session ID
- Uses `ClaudeChatRuntimeAdapter` with `sessionType: "thread"`
- Gets `ALL_SKILLS` (planning + execution + shared) via `systemPrompt.append`
- Gets user's plugins/MCPs/settings via `settingSources: ["user", "project", "local"]`
- Session persisted via `vendor_session_id` column on thread record (new column, migration required)
- No turn queue — one active session per thread

### Replaces Existing Orchestration

`ThreadTurnService` **fully replaces** `OrchestrationService` and `CoordinatorService` for thread execution. The old approach (programmatic worktree creation, hook deployment, agent process spawning) is replaced by a single `query()` call where the LLM manages its own workspace via skills.

The `coordinatorDispatchHandler` in `index.ts` will be updated to call `ThreadTurnService.startCoordinator()` instead of `orchestrationService.startThread()`.

## Coordinator Prompt

First turn prompt constructed from `seed_context_json`:

```
You are a thread coordinator executing an implementation plan.

## Instructions
- Use the using-git-worktrees skill to create an isolated worktree
- Execute the implementation plan using the subagent-driven-development skill
- Use test-driven-development for each task implementation
- Use verification-before-completion before claiming any task is done
- Use systematic-debugging if you encounter failures
- Do NOT re-plan. The plan is final. Execute it as written.
- Report progress as you complete each task
- If you hit a blocker, describe it clearly and wait for guidance

## Planning Context

### Conversation
[user]: {message content}
[assistant]: {message content}
...

### Artifacts
--- {path} ---
{file content}

### Attachments
{multimodal image/text content blocks}

Begin execution now.
```

Messages and artifacts are formatted as text. Image attachments are sent as multimodal content blocks (base64 image source) — same pattern as chat file uploads using `AsyncIterable<SDKUserMessage>` prompt.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `query()` throws/crashes | Set `executionState: "failed"`, store error in `failure_reason`, increment `restart_count`. Do NOT auto-retry. User can send a message to retry. |
| Resume fails (session expired) | Fall back to fresh `query()` with original seed context + conversation history. Log warning. |
| User sends message while coordinator is running | Reject with "Coordinator is currently running. Wait for it to finish or cancel." |
| Worktree creation fails (via skill) | Coordinator handles this — it reports the failure and sets `executionState: "blocked"`. No programmatic fallback. |
| Promote while another thread is running | Allowed for v1 (one coordinator per thread, threads are independent). |

## Main Chat → Thread Status (MCP Tool)

An in-process MCP server registered on main chat sessions only:

**Tool: `get_thread_status`**
- Input: `{ thread_id: string }`
- Reads from database: thread record (status, title, branch) + last 25 thread events + aggregate summary header
- Returns formatted text the main chat LLM can interpret
- Pure database read — no coordinator interaction
- Thread coordinator sessions do NOT get this tool

Implemented via `createSdkMcpServer()` from `@anthropic-ai/claude-agent-sdk` (exported in SDK types, not yet used in codebase — requires import: `import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"`).

## Thread Detail UI

Full chat experience in the thread detail pane — same fidelity as main chat. **This is the heaviest frontend task** — requires wiring the same streaming pipeline (`onEvent` → turn events → subscription → rendering) into the thread detail view.

**Included:**
- Streaming text + tool activity display (reuses `StreamingMessage`, `ToolActivityInline`, `PersistedAssistantMessage`)
- Input dock with model/thinking pills (read-only — config set at promote time)
- File upload button + drag-and-drop
- "Waiting for your response" indicator when coordinator is blocked

**Excluded:**
- Plan action bar (no `/plan` or `/promote` in thread)
- Plan marker commands

## Database Migration

New migration `0015_thread_vendor_session`:
```sql
ALTER TABLE threads ADD COLUMN vendor_session_id TEXT;
```

## Files

### New
- `apps/backend/src/threads/thread-turn-service.ts` — manages coordinator turns (start, resume, stream events, update status). One active session per thread.
- `apps/backend/src/threads/coordinator-prompt-builder.ts` — constructs initial prompt from `seed_context_json` (messages, artifacts, attachments → formatted text + multimodal content blocks)
- `apps/backend/src/threads/thread-status-mcp.ts` — in-process MCP server with `get_thread_status` tool for main chat

### Modified
- `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` — register status MCP server on main chat sessions
- `apps/backend/src/index.ts` — wire `ThreadTurnService`, replace `orchestrationService.startThread()` dispatch with `threadTurnService.startCoordinator()`
- `apps/backend/src/ipc/router.ts` — existing `threads.send_message` handler updated to route through `ThreadTurnService` for coordinator resume
- `apps/backend/src/threads/thread-service.ts` — update status transition methods
- `apps/backend/src/db/migrations.ts` — add migration 0015
- `packages/shared/src/contracts/threads.ts` — add thread turn event schemas if needed
- `apps/desktop/src/renderer/src/threads/ThreadDetail.tsx` — wire streaming conversation with input dock, file upload
- `apps/desktop/src/renderer/src/threads/thread-workflows.ts` — add coordinator turn workflows

### Unchanged
- `ChatTurnService` — chat turns unchanged
- `PromoteDrawer` — promote flow unchanged
- Skills / bundled-skills — already correct

## Out of Scope

- Full bidirectional relay (main chat sends messages TO coordinator) — v2, read-only status for now
- Multi-agent parallel dispatch — single coordinator for v1
- Thread lifecycle actions (approve, close, report back) — ULR-104
- Multiple concurrent threads executing — one at a time for v1
