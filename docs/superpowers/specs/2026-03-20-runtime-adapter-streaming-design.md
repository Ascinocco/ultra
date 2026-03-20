# ULR-19: Runtime Adapter Streaming Refactor

## Status

Design — approved, pending implementation.

## Objective

Replace CLI-spawn-based runtime adapters with programmatic interfaces that support real-time streaming. Claude adapter uses `@anthropic-ai/claude-agent-sdk`. Codex adapter uses `codex app-server` JSON-RPC mode. Both provide token-by-token streaming, full structured metadata, and tool activity — solving the fundamental limitation where CLI stdout is buffered when piped.

## Context

The current adapters spawn `claude -p` and `codex exec` as child processes, collect stdout after the process exits, then parse JSON events in batch. Even with PTY tricks, both CLIs buffer stdout when piped — real-time streaming is impossible with this architecture.

The reference implementation (`vendor/t3code/`) demonstrates the correct approach:
- Claude: `@anthropic-ai/claude-agent-sdk` provides an `AsyncIterable<SDKMessage>` with `text_delta` events
- Codex: `codex app-server` starts a JSON-RPC server that streams notifications over stdout

## Design Decisions

| Decision | Claude | Codex |
|----------|--------|-------|
| Integration | `@anthropic-ai/claude-agent-sdk` `query()` | `codex app-server` via JSON-RPC |
| Session model | One SDK session per chat (stateful) | One app-server process per chat (stateful) |
| Permissions | Autonomous by default; supervised mode wires `canUseTool` to approval infra (UI in ULR-34) | Autonomous by default; auto-approve JSON-RPC approval requests |
| Streaming | `AsyncIterable<SDKMessage>` with `text_delta` | JSON-RPC notifications with `delta` |
| Adapter interface | Same `ChatRuntimeAdapter` with `onEvent` | Same |
| Process runner | Removed from Claude adapter | Not used; adapter spawns `codex app-server` directly |
| Session continuity | SDK `resume` option with session ID | `thread/resume` JSON-RPC method |
| Initialization | SDK handles internally | Minimal handshake: `initialize` → `initialized` → `thread/start` |

---

## Sub-Project 1: Claude SDK Adapter

### Architecture

Replace `ClaudeChatRuntimeAdapter` internals. Instead of spawning `claude -p` via the process runner, use `@anthropic-ai/claude-agent-sdk`'s `query()` function.

**New dependency:** `@anthropic-ai/claude-agent-sdk` added to `apps/backend/package.json`.

### Constructor

Remove `RuntimeProcessRunner` dependency. Accept SDK configuration:

```ts
constructor(config: {
  pathToClaudeCodeExecutable?: string  // defaults to "claude"
  defaultEnv?: NodeJS.ProcessEnv
})
```

### Session Management

**`ClaudeSessionManager`** (internal to adapter):

```ts
class ClaudeSessionManager {
  private sessions: Map<ChatId, ClaudeSessionContext>

  getOrCreate(chatId: ChatId, config: SessionConfig): ClaudeSessionContext
  destroy(chatId: ChatId): void
  destroyAll(): void
}
```

**`ClaudeSessionContext`** holds:
- `query`: The SDK runtime (`AsyncIterable<SDKMessage>` + control methods: `interrupt()`, `setModel()`, `close()`)
- `promptQueue`: Queue where user messages are pushed (SDK consumes via async iterable)
- `vendorSessionId`: Session ID for the SDK (our generated ID or resumed ID)
- `streamFiber`: Background consumer of the async iterable (processes SDK messages as they arrive)
- `stopped`: Flag to halt stream consumption

**Session lifecycle:**
- Created on first `runTurn` call for a `chatId`
- Reused for subsequent turns (conversation continuity via persistent SDK session)
- Destroyed when chat is archived/deleted, on unrecoverable SDK error, or on backend shutdown

### runTurn Flow

```
1. getOrCreate session for request.chatId
2. Build SDKUserMessage from request.prompt
3. Create a per-turn event collector
4. Queue user message to session's prompt stream
5. Consume async iterable — for each SDKMessage:
   a. Map to ChatRuntimeEvent(s)
   b. Call request.onEvent(event) if provided (streaming path)
   c. Collect event in turn collector
6. On result message: extract finalText, vendorSessionId
7. Return ChatRuntimeTurnResult with collected events + diagnostics
```

When `request.onEvent` is not provided (synchronous `sendMessage` path), the same flow runs but events are only collected, not streamed.

### Event Mapping

| SDK Event | ChatRuntimeEvent | Payload |
|-----------|-----------------|---------|
| `content_block_delta` + `text_delta` | `assistant_delta` | `{ text }` |
| `content_block_delta` + `thinking_delta` | `runtime_notice` | `{ message: thinking_text }` |
| `content_block_start` + `tool_use` | `tool_activity` | `{ label: tool_name, metadata: { input } }` |
| Tool result (from user message) | `tool_activity` | `{ label: "tool_result", metadata: { output } }` |
| `result` (success) | `assistant_final` | `{ text: final_text }` |
| `result` (error) | `runtime_error` | `{ message: error_text }` |

**Session ID extraction:** The first SDK message containing `session_id` is captured on the session context and returned as `vendorSessionId` in the turn result.

**Unmapped events:** `content_block_start` for text blocks, `content_block_stop`, `message_start`, `message_stop` — lifecycle noise, not mapped.

### Permission Handling

The SDK's `canUseTool` callback controls tool approval:

**Autonomous mode (default):**
```ts
canUseTool: async () => ({ allowed: true })
```

**Supervised mode** (when `config.permissionLevel === "supervised"`):
1. Emit `tool_activity` event via turn's `onEvent` with tool name and input
2. Create a pending approval promise keyed by a unique request ID
3. Return the promise — SDK blocks until resolved
4. When `chats.resolve_approval` IPC command arrives, resolve the promise with the decision

The supervised approval UI is out of scope (ULR-34). The adapter wires the infrastructure; the IPC command and frontend are built later.

### SDK Query Options

```ts
const queryOptions: ClaudeQueryOptions = {
  cwd: request.cwd,
  model: request.config.model,
  pathToClaudeCodeExecutable: this.config.pathToClaudeCodeExecutable ?? "claude",
  permissionMode: mapPermissionLevel(request.config.permissionLevel),
  includePartialMessages: true,
  canUseTool: buildCanUseToolCallback(request.config.permissionLevel, onApproval),
  env: this.config.defaultEnv ?? process.env,
  // Required when permissionMode is "bypassPermissions"
  ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
  // Resume existing session or create new
  ...(existingSessionId ? { resume: existingSessionId } : { sessionId: newSessionId }),
}
```

### Cancellation via AbortSignal

When `request.signal` is provided and fires, the adapter:
1. Calls `query.interrupt()` to stop the SDK's current operation
2. Sets `context.stopped = true` to halt async iterable consumption
3. The turn resolves with whatever events have been collected so far

### Error Handling

If the SDK's async iterable throws mid-stream (e.g., network error, process crash):
1. Catch the error in the stream consumer
2. Emit a `runtime_error` event via `onEvent`
3. Return a `ChatRuntimeTurnResult` with collected events and the error
4. Destroy and recreate the session on next `runTurn` call

### What Gets Removed

- `parseClaudeLines` / `parseClaudeLine` functions
- `buildClaudeArgs` function
- `extractTextCandidate` usage (from runtime-helpers.ts, only if Codex no longer uses it)
- Process runner dependency in constructor
- All Claude CLI flag logic (`--verbose`, `--output-format stream-json`, `--include-partial-messages`, etc.)

---

## Sub-Project 2: Codex App-Server Adapter

### Architecture

Replace `CodexChatRuntimeAdapter` internals. Instead of spawning `codex exec` via the process runner, spawn `codex app-server` as a long-lived JSON-RPC server and communicate via stdin/stdout.

### JsonRpcClient Utility

**File:** `apps/backend/src/chats/runtime/json-rpc-client.ts`

A generic JSON-RPC 2.0 client over stdin/stdout pipes:

```ts
class JsonRpcClient {
  constructor(process: ChildProcess)

  // Send request, wait for response with matching ID
  request<T>(method: string, params?: unknown): Promise<T>

  // Send notification (no response expected)
  notify(method: string, params?: unknown): void

  // Subscribe to incoming notifications
  onNotification(handler: (method: string, params: unknown) => void): () => void

  // Subscribe to incoming requests (server → client, e.g., approvals)
  onRequest(handler: (id: string | number, method: string, params: unknown) => void): () => void

  // Respond to an incoming server request
  respond(id: string | number, result: unknown): void
  respondError(id: string | number, code: number, message: string): void

  // Cleanup
  destroy(): void
}
```

**Protocol:**
- One JSON object per line over stdin (outgoing) and stdout (incoming)
- Uses `readline.createInterface` on stdout for line splitting
- Request IDs are auto-incrementing integers
- 20-second timeout per request (configurable)
- Incoming messages classified by shape: `{ id, method }` = server request, `{ method, !id }` = notification, `{ id, !method }` = response

### Constructor

```ts
constructor(config: {
  codexBinaryPath?: string  // defaults to "codex"
  codexHomePath?: string    // CODEX_HOME env var
})
```

No process runner dependency.

### Session Management

**`CodexSessionManager`** (internal to adapter):

```ts
class CodexSessionManager {
  private sessions: Map<ChatId, CodexSessionContext>

  getOrCreate(chatId: ChatId, config: SessionConfig): Promise<CodexSessionContext>
  destroy(chatId: ChatId): void
  destroyAll(): void
}
```

**`CodexSessionContext`** holds:
- `child`: The `codex app-server` child process
- `rpcClient`: `JsonRpcClient` wrapping the child's stdin/stdout
- `providerThreadId`: The Codex thread ID (from `thread/start` or `thread/resume`)
- `activeTurnId`: Current turn ID if a turn is running
- `notificationHandler`: Disposable for notification subscription

**Session creation sequence:**
1. `spawn("codex", ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })`
2. Create `JsonRpcClient` wrapping the child process
3. Attach `child.on("exit")` and `child.on("error")` listeners for crash detection
4. `rpcClient.request("initialize", { clientInfo: { name: "ultra", version: "1.0.0" }, capabilities: { experimentalApi: true } })`
5. `rpcClient.notify("initialized")`
6. `rpcClient.request("thread/start", { model, approvalPolicy: "on-request", sandbox, experimentalRawEvents: false })` — returns `{ thread: { id } }`
7. Store `providerThreadId` as `vendorSessionId` in the runtime session manager (for persistence across backend restarts)

**Session resumption:** On subsequent session creation for the same chat (e.g., after backend restart), use `thread/resume` with the stored `vendorSessionId` (= `providerThreadId`). Fall back to `thread/start` if resume fails with "not found" / "missing thread" / "unknown thread" errors.

**Process crash detection:** The `child.on("exit")` listener triggers:
1. Session cleanup (remove from map)
2. If a turn was in flight, emit `runtime_error` event and fail the turn
3. Next `runTurn` call auto-recreates the session

**Session lifecycle:** Same as Claude — destroyed on chat archive/delete, unrecoverable error, or backend shutdown.

### runTurn Flow

```
1. getOrCreate session for request.chatId
2. Register notification handler for streaming events
3. Send: rpcClient.request("turn/start", {
     threadId: context.providerThreadId,
     input: [{ type: "text", text: request.prompt, text_elements: [] }],
     model: request.config.model,
   })
4. Response gives us turnId
5. Notifications stream in:
   - item/agentMessage/delta → emit assistant_delta via request.onEvent
   - item/started, item/completed → emit tool_activity
   - turn/completed → resolve turn
6. For approval requests (incoming server requests):
   - Auto-respond { decision: "approved" } (autonomous mode)
   - Or route to approval infrastructure (supervised mode)
7. On turn/completed: collect final text from accumulated deltas
8. Return ChatRuntimeTurnResult
```

### Event Mapping

| JSON-RPC Notification | ChatRuntimeEvent | Payload |
|----------------------|-----------------|---------|
| `item/agentMessage/delta` | `assistant_delta` | `{ text: params.delta }` |
| `item/reasoning/textDelta` | `runtime_notice` | `{ message: params.delta }` |
| `item/commandExecution/outputDelta` | `tool_activity` | `{ label: "command_output", metadata: { delta: params.delta } }` |
| `item/fileChange/outputDelta` | `tool_activity` | `{ label: "file_change", metadata: { delta: params.delta } }` |
| `item/started` | `tool_activity` | `{ label: params.item.type, metadata: params }` |
| `item/completed` | `tool_activity` | `{ label: params.item.type, metadata: params }` |
| `turn/completed` | `assistant_final` | `{ text: accumulated_assistant_text }` |
| `error` | `runtime_error` | `{ message: params.message }` |

**Approval requests** (incoming JSON-RPC requests with ID):

| Method | Action |
|--------|--------|
| `item/commandExecution/requestApproval` | Auto-respond `{ decision: "approved" }` or route to approval infra |
| `item/fileRead/requestApproval` | Same |
| `item/fileChange/requestApproval` | Same |
| `item/tool/requestUserInput` | Auto-respond with first option or route |

### Cancellation via AbortSignal

When `request.signal` fires, the adapter:
1. Sends `rpcClient.request("turn/interrupt", { turnId: context.activeTurnId })`
2. Waits for `turn/aborted` notification to confirm cancellation
3. Returns collected events with whatever text was accumulated

### Error Handling

On child process crash (detected via `exit` listener):
1. Emit `runtime_error` event via `onEvent`
2. Reject any pending JSON-RPC requests
3. Destroy the session context
4. Turn service will fail the turn via its existing error handling

### What Gets Removed

- `parseCodexLines` / `parseCodexLine` functions
- `buildArgs` function (for `codex exec`)
- Process runner dependency in constructor
- All `codex exec` CLI flag logic (`--json`, `-a never`, etc.)

---

## Shared Infrastructure

### ChatRuntimeAdapter Interface — Unchanged

```ts
interface ChatRuntimeAdapter {
  readonly provider: ChatRuntimeConfig["provider"]
  runTurn(request: ChatRuntimeTurnRequest): Promise<ChatRuntimeTurnResult>
}
```

### ChatRuntimeTurnResult — One Type Change

The `diagnostics` field must be made optional. The Claude SDK adapter has no child process to report diagnostics for. The Codex adapter's long-lived process doesn't exit per-turn either.

```ts
// In types.ts, change:
diagnostics: RuntimeProcessResult
// To:
diagnostics?: RuntimeProcessResult
```

The turn service's `ChatRuntimeError` already accepts optional diagnostics, so this is safe.

### ChatRuntimeTurnRequest — Unchanged

The `onEvent` callback added in the earlier streaming work remains the streaming mechanism. Both adapters call it incrementally as events arrive.

### Turn Service — Unchanged

The `executeClaimedTurn` → `runTurnWithRecovery` → `adapter.runTurn()` chain stays the same. The `streamingOnEvent` callback persists and notifies events via the subscription system. No turn service changes needed.

### Frontend — Already Implemented

The streaming frontend hooks from the earlier work are ready:
- `useStreamingText` — accumulates `chat.turn_assistant_delta` events
- `useAutoScroll` — smart scroll-to-bottom
- `ChatMessage` with `isStreaming` prop and typing indicator
- `ChatPageShell` wired with streaming message display

These will work as-is once the backend adapters emit real-time events.

---

## Adapter Registration

**File:** `apps/backend/src/index.ts`

Current:
```ts
const chatRuntimeProcessRunner = new SpawnRuntimeProcessRunner()
// ...
new ClaudeChatRuntimeAdapter(chatRuntimeProcessRunner),
new CodexChatRuntimeAdapter(chatRuntimeProcessRunner),
```

New:
```ts
new ClaudeChatRuntimeAdapter({
  pathToClaudeCodeExecutable: "claude",
}),
new CodexChatRuntimeAdapter({
  codexBinaryPath: "codex",
}),
```

The process runner is still used by other parts of the system (terminal sessions, etc.) but is no longer needed by the runtime adapters.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/backend/src/chats/runtime/json-rpc-client.ts` | Generic JSON-RPC 2.0 client over stdin/stdout |
| `apps/backend/src/chats/runtime/json-rpc-client.test.ts` | Unit tests for JSON-RPC client |
| `apps/backend/src/chats/runtime/claude-session-manager.ts` | Manages SDK sessions per chat |
| `apps/backend/src/chats/runtime/codex-session-manager.ts` | Manages app-server processes per chat |

### Modified Files

| File | Change |
|------|--------|
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` | Rewrite internals to use SDK |
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.test.ts` | Rewrite tests to mock SDK |
| `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts` | Rewrite internals to use app-server |
| `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.test.ts` | Rewrite tests to mock JSON-RPC |
| `apps/backend/src/chats/runtime/types.ts` | Add session manager types if needed |
| `apps/backend/src/index.ts` | Update adapter construction |
| `apps/backend/package.json` | Add `@anthropic-ai/claude-agent-sdk` dependency |

### Removed Code (within modified files)

- `parseClaudeLines`, `parseClaudeLine`, `buildClaudeArgs` — from Claude adapter
- `parseCodexLines`, `parseCodexLine`, `buildArgs` — from Codex adapter
- CLI-specific helpers used only by the old adapters

---

## Testing

### Claude Adapter
- Mock `query()` to return a fake async iterable of `SDKMessage` objects
- Test: `text_delta` events emit `assistant_delta` via `onEvent`
- Test: `tool_use` events emit `tool_activity`
- Test: `result` message returns correct `ChatRuntimeTurnResult`
- Test: session reuse across multiple `runTurn` calls
- Test: session destruction and recreation on error
- Test: autonomous permission mode auto-approves
- Test: `onEvent` not provided (batch path) still works

### Codex Adapter
- Mock `codex app-server` child process with fake stdin/stdout
- Test: JSON-RPC handshake completes
- Test: `turn/start` request and response
- Test: `item/agentMessage/delta` notifications emit `assistant_delta`
- Test: approval requests auto-approved in autonomous mode
- Test: `turn/completed` returns correct result
- Test: session resumption via `thread/resume`
- Test: process crash handling and session cleanup

### JsonRpcClient
- Test: request/response pairing with correct IDs
- Test: notification dispatch
- Test: incoming server request handling
- Test: timeout on unresponsive requests
- Test: concurrent requests

---

## Implementation Order

1. **Claude adapter first** — simpler (SDK handles protocol), more commonly tested
2. **JsonRpcClient utility** — needed before Codex adapter
3. **Codex adapter second** — more complex (JSON-RPC state machine)
4. **Integration testing** — both adapters with real CLIs

Each sub-project is independently deployable — Claude adapter can ship while Codex is in progress.

---

## Out of Scope

- Supervised permission approval UI (ULR-34)
- Codex collaboration/multi-thread support (t3code's `collabAgentToolCall`)
- Thread rollback (`thread/rollback` JSON-RPC)
- Model listing from Codex app-server
- Account/billing queries from Codex app-server

## References

- `vendor/t3code/apps/server/src/provider/Layers/ClaudeAdapter.ts` — Claude SDK reference
- `vendor/t3code/apps/server/src/codexAppServerManager.ts` — Codex app-server reference
- `vendor/t3code/packages/contracts/src/providerRuntime.ts` — Event type reference
- `@anthropic-ai/claude-agent-sdk` npm package
- `docs/backend-ipc.md`
- `docs/cli-runtime-contract.md`
