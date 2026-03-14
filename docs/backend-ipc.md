# Ultra Backend IPC

## Status

Draft v0.1

This document defines the internal IPC contract between the Ultra frontend application and the Ultra backend.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)

## Purpose

Ultra needs a backend IPC that is:

- private to the Ultra app
- simple to implement in v1
- structured enough to support multiple chats, multiple threads, and live runtime state
- durable enough to support replay and recovery

This IPC is not a public API in v1.

## Scope

The IPC is used by:

- the chat page frontend
- the thread pane frontend
- the editor page integration layer
- internal app surfaces that need project runtime state

It is not designed as a public SDK or CLI interface.

## Transport

Use a Unix domain socket with JSON message envelopes.

### Why

- local-only communication
- simple Bun/TypeScript implementation
- no need for HTTP routing overhead in v1
- easy to secure with user-level socket permissions

## Protocol Model

Use a hybrid protocol:

- `commands` for mutations
- `queries` for snapshots
- `subscriptions` for live updates and event streams

### Product Rule

Do not model the app around one large `active chat` payload.

The backend should expose domain-oriented resources. The frontend should compose them into UI state.

## Versioning and Handshake

Every message must include:

- `protocol_version`
- `request_id`

### Required Handshake

The client first sends:

- `system.hello`

The backend responds with:

- accepted protocol version
- backend version
- capability flags
- session ID

### Version Rule

If protocol versions are incompatible, the backend must reject the session explicitly.

## Envelope Types

### Command Request

```json
{
  "protocol_version": "1.0",
  "request_id": "req_123",
  "type": "command",
  "name": "threads.approve",
  "payload": {
    "thread_id": "thread_123"
  }
}
```

### Query Request

```json
{
  "protocol_version": "1.0",
  "request_id": "req_124",
  "type": "query",
  "name": "threads.get",
  "payload": {
    "thread_id": "thread_123"
  }
}
```

### Subscription Request

```json
{
  "protocol_version": "1.0",
  "request_id": "req_125",
  "type": "subscribe",
  "name": "threads.events",
  "payload": {
    "thread_id": "thread_123",
    "from_sequence": 42
  }
}
```

### Success Response

```json
{
  "protocol_version": "1.0",
  "request_id": "req_123",
  "type": "response",
  "ok": true,
  "result": {
    "status": "accepted",
    "operation_id": "op_789"
  }
}
```

### Error Response

```json
{
  "protocol_version": "1.0",
  "request_id": "req_123",
  "type": "response",
  "ok": false,
  "error": {
    "code": "thread_not_found",
    "message": "Thread does not exist"
  }
}
```

### Subscription Event

```json
{
  "protocol_version": "1.0",
  "type": "event",
  "subscription_id": "sub_456",
  "event_name": "threads.event",
  "payload": {
    "thread_id": "thread_123",
    "sequence_number": 43,
    "event_type": "thread.approved"
  }
}
```

## Async Operation Model

Commands that may take time should return quickly with:

- `accepted`
- `operation_id`

Progress and completion should then flow through subscriptions and updated snapshots.

### Why

- thread creation is async
- publish is async
- runtime recovery is async
- editor opening/sync may be async

Do not block IPC calls waiting for long-running operations to finish.

## Namespaces

The v1 IPC should expose these namespaces:

- `system.*`
- `projects.*`
- `chats.*`
- `threads.*`
- `editor.*`
- `runtime.*`
- `approvals.*`
- `artifacts.*`

## `system.*`

Purpose:

- handshake
- backend info
- capability negotiation

Recommended methods:

- `system.hello`
- `system.get_backend_info`
- `system.ping`

## `projects.*`

Purpose:

- project open/load
- project metadata
- project layout
- project summaries

Recommended methods:

- `projects.list`
- `projects.get`
- `projects.open`
- `projects.get_layout`
- `projects.set_layout`

Recommended project subscriptions:

- `projects.updated`
- `projects.layout_updated`

## `chats.*`

Purpose:

- chat lifecycle
- chat messaging
- chat config
- plan/spec approvals
- thread creation initiation

Recommended commands:

- `chats.create`
- `chats.rename`
- `chats.pin`
- `chats.unpin`
- `chats.archive`
- `chats.restore`
- `chats.update_config`
- `chats.send_message`
- `chats.approve_plan`
- `chats.approve_specs`
- `chats.start_thread`

Recommended queries:

- `chats.list`
- `chats.get`
- `chats.get_messages`
- `chats.get_session`
- `chats.get_references`

Recommended subscriptions:

- `chats.updated`
- `chats.messages`
- `chats.references`

### Chat Config Payload

`chats.update_config` should support:

- `provider`
- `model`
- `thinking_level`
- `permission_level`

## `threads.*`

Purpose:

- thread snapshots
- thread actions
- coordinator chat
- event history

Recommended commands:

- `threads.send_message`
- `threads.request_changes`
- `threads.approve`
- `threads.publish`
- `threads.open_in_editor`

Recommended queries:

- `threads.list_by_project`
- `threads.list_by_chat`
- `threads.get`
- `threads.get_events`
- `threads.get_agents`
- `threads.get_logs`
- `threads.get_approvals`

Recommended subscriptions:

- `threads.updated`
- `threads.events`
- `threads.agents`
- `threads.logs`

### Replay Requirement

`threads.events` must support replay from a checkpoint.

Minimum replay fields:

- `thread_id`
- `from_sequence`

If no checkpoint is provided, the backend may stream from the current tip or a recent default window.

## `editor.*`

Purpose:

- active target selection
- opening editor surfaces
- terminal actions
- runtime file sync

Recommended commands:

- `editor.set_active_target`
- `editor.open_in_target`
- `editor.open_terminal`
- `editor.open_diff`
- `editor.open_changed_files`
- `editor.sync_runtime_files`

Recommended queries:

- `editor.get_targets`
- `editor.get_active_target`
- `editor.get_runtime_profile`

Recommended subscriptions:

- `editor.targets_updated`
- `editor.active_target_updated`
- `editor.runtime_sync_updated`

## `runtime.*`

Purpose:

- project runtime health
- coordinator/watch/watchdog state
- chat-driven runtime actions

Recommended commands:

- `runtime.restart_coordinator`
- `runtime.restart_watchdog`
- `runtime.retry_thread`
- `runtime.pause_project_runtime`
- `runtime.resume_project_runtime`

Recommended queries:

- `runtime.get_project_health`
- `runtime.get_project_runtime`
- `runtime.get_components`

Recommended subscriptions:

- `runtime.health_updated`
- `runtime.component_updated`
- `runtime.project_runtime_updated`

### Product Rule

These commands may exist in IPC even if the user reaches them only through main chat UX.

The backend still needs explicit operations to execute.

## `approvals.*`

Purpose:

- thread-specific approval state and resolution

Recommended commands:

- `approvals.resolve`

Recommended queries:

- `approvals.list_by_thread`
- `approvals.get`

Recommended subscriptions:

- `approvals.updated`

## `artifacts.*`

Purpose:

- thread-associated generated outputs
- reviewable assets
- publish artifacts

Recommended queries:

- `artifacts.list_by_thread`
- `artifacts.get`

Recommended subscriptions:

- `artifacts.updated`

## Snapshot vs Stream Boundaries

Use this rule consistently:

- snapshots for current state
- event streams for evolving state
- large raw logs fetched separately

### Snapshots

The following should always have direct query access:

- project summaries
- chat summaries
- chat config
- thread snapshots
- runtime health
- editor targets

### Streams

The following should have live subscription streams:

- chat messages
- thread events
- thread agent activity
- thread logs
- runtime health updates
- editor target/runtime sync changes

## Error Model

Use structured error responses.

Recommended error fields:

- `code`
- `message`
- `details`
- `retryable`

Recommended error codes:

- `invalid_request`
- `unsupported_protocol_version`
- `not_found`
- `conflict`
- `invalid_state_transition`
- `permission_denied`
- `runtime_unavailable`
- `timeout`
- `internal_error`

## Frontend State Model

The frontend should use a normalized domain store.

Do not store all nested app state inside one `activeChat` object.

### Recommended Zustand Shape

```ts
type AppState = {
  activeProjectId: string | null;
  activeChatId: string | null;
  selectedThreadId: string | null;
  projects: Record<string, ProjectSnapshot>;
  chats: Record<string, ChatSnapshot>;
  chatListsByProject: Record<string, string[]>;
  threads: Record<string, ThreadSnapshot>;
  threadListsByChat: Record<string, string[]>;
  threadEventsByThread: Record<string, ThreadEvent[]>;
  runtimeByProject: Record<string, ProjectRuntimeSnapshot>;
  editorByProject: Record<string, EditorProjectState>;
  layoutByProject: Record<string, ProjectLayoutState>;
};
```

### Layout State

Per-project layout state should include:

- `rightTopCollapsed`
- `rightBottomCollapsed`
- `selectedRightPaneTab`
- `selectedBottomPaneTab`
- `lastEditorTargetId`

This supports the collapsible thread/status panels you want without coupling layout to chat state.

## Recommended Subscription Topology

On project open:

- query project snapshot
- query chat list
- query thread list
- query runtime snapshot
- query editor target snapshot
- subscribe to project/runtime updates

On chat select:

- query chat details/messages
- subscribe to chat message stream
- subscribe to chat reference updates if needed

On thread select:

- query thread snapshot
- query recent events
- query agents
- query approvals
- subscribe to thread events from latest known sequence
- subscribe to thread agents/logs as needed

This keeps the UI responsive without over-fetching everything all the time.

## Security Model

The IPC is local and user-scoped.

### v1 Security Rules

- socket path must be user-private
- only the current user account should be able to connect
- backend should reject unknown protocol versions
- no additional auth layer is required in v1

## Minimal v1 Method Set

If implementation needs to start narrower, these are the essential methods:

- `system.hello`
- `projects.open`
- `projects.get`
- `chats.list`
- `chats.create`
- `chats.send_message`
- `chats.update_config`
- `chats.approve_plan`
- `chats.approve_specs`
- `chats.start_thread`
- `threads.list_by_chat`
- `threads.get`
- `threads.events`
- `threads.send_message`
- `threads.request_changes`
- `threads.approve`
- `threads.publish`
- `threads.open_in_editor`
- `editor.get_targets`
- `editor.set_active_target`
- `editor.open_terminal`
- `editor.sync_runtime_files`
- `runtime.get_project_health`
- `runtime.health_updated`

## Locked Decisions

1. IPC is private to the Ultra app in v1
2. Transport is Unix domain socket plus JSON envelopes
3. Protocol shape is command/query/subscription
4. Async commands return `operation_id`
5. Thread subscriptions support replay from checkpoint
6. Runtime control actions exist as backend commands even if exposed only through chat
7. Frontend state should be normalized rather than centered on one nested active-chat object

## Open Follow-Ups

1. exact payload schemas for each command/query/subscription
2. whether some editor actions should be fire-and-forget UI bridge commands instead of true backend operations
3. how log pagination should work for very large thread logs
4. whether some query results should be cached in the frontend store across project switches
