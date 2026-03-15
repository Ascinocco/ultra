# Ultra Backend IPC

## Status

Draft v0.2

This document defines the internal IPC contract between the Ultra frontend application and the Ultra backend.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [worktree-terminal-model.md](/Users/tony/Projects/ultra/docs/worktree-terminal-model.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)

## Purpose

Ultra needs a backend IPC that is:

- private to the Ultra app
- simple to implement in v1
- structured enough to support multiple projects, multiple chats, multiple threads, and live runtime state
- durable enough to support replay and recovery

This IPC is not a public API in v1.

## Scope

The IPC is used by:

- the multi-project chat shell frontend
- the right-side thread pane frontend
- the sandbox selector and terminal drawer
- internal app surfaces that need project runtime state

It is not designed as a public SDK or CLI interface.

## Transport

Use a Unix domain socket with JSON message envelopes.

## Protocol Model

Use a hybrid protocol:

- `commands` for mutations
- `queries` for snapshots
- `subscriptions` for live updates and event streams

### Product Rule

Do not model the app around one giant `active workspace` payload.

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

## Async Operation Model

Commands that may take time should return quickly with:

- `accepted`
- `operation_id`

Progress and completion should then flow through subscriptions and updated snapshots.

### Why

- thread creation is async
- thread execution is async
- runtime recovery is async
- sandbox sync and terminal launch may be async

Do not block IPC calls waiting for long-running operations to finish.

## Namespaces

The v1 IPC should expose these namespaces:

- `system.*`
- `projects.*`
- `chats.*`
- `threads.*`
- `sandboxes.*`
- `terminal.*`
- `handoff.*`
- `voice.*`
- `attachments.*`
- `runtime.*`
- `approvals.*`
- `artifacts.*`

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

## `chats.*`

Purpose:

- chat lifecycle
- chat messaging
- chat config
- plan and spec approvals
- thread creation initiation

Recommended methods:

- `chats.list`
- `chats.get`
- `chats.create`
- `chats.rename`
- `chats.archive`
- `chats.restore`
- `chats.send_message`
- `chats.get_messages`
- `chats.approve_plan`
- `chats.approve_specs`
- `chats.start_thread`

## `threads.*`

Purpose:

- execution thread lifecycle
- execution visibility
- coordinator interaction
- review actions

Recommended methods:

- `threads.list`
- `threads.get`
- `threads.get_messages`
- `threads.get_events`
- `threads.get_agents`
- `threads.send_message`
- `threads.request_changes`
- `threads.approve`

Important rule:

- threads are the user-facing execution stream
- coordinator and Overstory mechanics remain behind the thread projection boundary

## `sandboxes.*`

Purpose:

- resolve which concrete checkout Ultra is targeting
- hide worktree mechanics behind a simpler shell concept
- make terminal and runtime sync deterministic

Recommended methods:

- `sandboxes.list`
- `sandboxes.get_active`
- `sandboxes.set_active`
- `sandboxes.get_runtime_sync`

### Product Rule

The frontend should talk in terms of `sandboxes`, not `worktrees`.

Internally, a sandbox may be:

- the main project checkout
- an Overstory-managed thread worktree

## `terminal.*`

Purpose:

- open or focus a terminal session for the active sandbox
- run saved commands
- surface session metadata and sync state

Recommended methods:

- `terminal.open`
- `terminal.list_sessions`
- `terminal.run_saved_command`
- `terminal.get_runtime_profile`
- `terminal.sync_runtime_files`

## `handoff.*`

Purpose:

- external editor handoff
- GitHub handoff
- browser handoff

Recommended methods:

- `handoff.open_in_editor`
- `handoff.open_in_github`
- `handoff.open_in_browser`

## Subscription Model

Subscriptions should focus on durable user-facing domains:

- `projects.updated`
- `projects.layout_updated`
- `chats.updated`
- `chats.messages`
- `threads.updated`
- `threads.messages`
- `threads.events`
- `runtime.updated`
- `approvals.updated`

Sandbox changes may flow through direct queries or through project and thread updates.

## Shell Composition Rule

The frontend shell should derive this shape from IPC:

- left sidebar: projects and chats
- center pane: active chat
- right pane: threads
- bottom drawer: terminal

The backend should support this composition directly instead of assuming one-project-per-window routing.
