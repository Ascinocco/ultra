# Thread Coordinator — Design Spec

**Ticket:** ULR-84
**Date:** 2026-03-21
**Status:** Approved

## Goal

Wire the thread coordinator end-to-end: when a chat is promoted to a thread, a separate Claude SDK session receives the seed context and begins autonomous plan execution using subagent-driven-development.

## Coordinator Lifecycle

1. User promotes chat to thread → `promoteToThread` creates thread record with `seed_context_json`
2. Coordinator dispatch fires immediately — spawns a `query()` session
3. Coordinator creates a worktree, reads the plan from seed context, executes tasks autonomously
4. Streaming events flow to the thread detail UI in real-time
5. When `query()` ends, session ID stored on thread for resumption
6. Thread status updates: `ready_for_review` if plan completed, `waiting_for_input` if blocked

User can send messages via the thread detail pane → triggers `query()` with `resume: sessionId` → coordinator picks up with new context.

## Thread States

| State | Meaning |
|-------|---------|
| `running` | Coordinator is actively working |
| `ready_for_review` | Coordinator finished execution, user reviews work |
| `waiting_for_input` | Coordinator hit a blocker, needs user guidance |
| `changes_requested` | User sent feedback, coordinator addressing it |
| `completed` | User explicitly marked done (manual action) |
| `archived` | User archived after completion |

The coordinator decides between `ready_for_review` and `waiting_for_input` based on execution outcome. `completed` is only set by explicit user action — never by the coordinator.

## Coordinator Session Architecture

- Completely separate `query()` session from the main chat — different context window, different session ID
- Uses `ClaudeChatRuntimeAdapter` with `sessionType: "thread"`
- Gets `ALL_SKILLS` (planning + execution + shared) via `systemPrompt.append`
- Gets user's plugins/MCPs/settings via `settingSources: ["user", "project", "local"]`
- Session persisted via `vendorSessionId` on thread record for resume
- No turn queue — one active session per thread

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

## Main Chat → Thread Status (MCP Tool)

An in-process MCP server registered on main chat sessions only:

**Tool: `get_thread_status`**
- Input: `{ thread_id: string }`
- Reads from database: thread record (status, title, branch) + last 25 thread events + aggregate summary
- Returns formatted text:
  ```
  Thread: "Add auth middleware" (status: running)
  Branch: feature/auth-middleware
  Summary: 5 tasks total, 3 completed, 1 running, 1 pending
  Recent activity:
  - Completed task 1/5: Token validator
  - Completed task 2/5: Session store
  - Running task 3/5: Middleware wrapper
  ```
- Pure database read — no coordinator interaction
- Thread coordinator sessions do NOT get this tool

Implemented via `createSdkMcpServer()` from the Claude Agent SDK.

## Thread Detail UI

Full chat experience in the thread detail pane — same fidelity as main chat:

**Included:**
- Streaming text + tool activity display (reuses `StreamingMessage`, `ToolActivityInline`, `PersistedAssistantMessage`)
- Input dock with model/thinking pills (read-only — config set at promote time)
- File upload button + drag-and-drop
- "Waiting for your response" indicator when coordinator is blocked

**Excluded:**
- Plan action bar (no `/plan` or `/promote` in thread)
- Plan marker commands

## Files

### New
- `apps/backend/src/threads/thread-turn-service.ts` — manages coordinator turns (start, resume, stream events, update status). One active session per thread.
- `apps/backend/src/threads/coordinator-prompt-builder.ts` — constructs initial prompt from `seed_context_json` (messages, artifacts, attachments → formatted text + multimodal content blocks)
- `apps/backend/src/threads/thread-status-mcp.ts` — in-process MCP server with `get_thread_status` tool for main chat

### Modified
- `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` — register status MCP server on main chat sessions
- `apps/backend/src/index.ts` — wire `ThreadTurnService`, replace orchestration dispatch with coordinator spawn
- `apps/backend/src/ipc/router.ts` — add `threads.send_coordinator_message` command
- `apps/backend/src/threads/thread-service.ts` — update thread status transitions
- `packages/shared/src/contracts/threads.ts` — add thread turn event schemas
- `packages/shared/src/contracts/ipc.ts` — register new IPC commands
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
