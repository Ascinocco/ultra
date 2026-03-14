# Ultra Runtime Wiring

## Scope

This document covers:

- coordinator supervision
- global `ov watch`
- project watchdogs
- runtime health
- chat-driven runtime control

## Flow: Ensure Project Runtime

Trigger:

- a thread is started or project runtime is otherwise needed

Backend:

- ensure global `ov watch`
- ensure project coordinator
- ensure project watchdog

DB:

- `project_runtimes`
- `runtime_components`
- `runtime_health_checks`

Events:

- runtime component updates
- thread runtime events if startup affects a thread

## Flow: Start Thread Through Coordinator

Trigger:

- `chats.start_thread`

IPC:

- internal routing from chat/thread services to runtime services

Backend:

- ensure project coordinator exists
- send thread start to coordinator
- update thread execution state/events as work begins

DB:

- `threads`
- `thread_events`
- `project_runtimes`

## Flow: Runtime Health Update

Trigger:

- heartbeat, watchdog probe, or process transition

IPC:

- `runtime.health_updated`
- `runtime.component_updated`
- `runtime.project_runtime_updated`

Backend:

- update component state
- recompute project aggregate health

DB:

- `runtime_components`
- `runtime_health_checks`
- `project_runtimes`

Store updates:

- patch runtime slice for active project
- refresh bottom-right status pane

## Flow: Main Chat Runtime Request

User action:

- ask main chat to restart or inspect runtime

IPC:

- `chats.get_runtime_context`
- one of:
  - `runtime.restart_coordinator`
  - `runtime.restart_watchdog`
  - `runtime.pause_project_runtime`
  - `runtime.resume_project_runtime`
  - `runtime.retry_thread`

Backend:

- fetch focused runtime context for the chat runtime
- execute requested runtime action
- emit runtime and thread events as needed

DB:

- `runtime_components`
- `runtime_health_checks`
- `project_runtimes`
- `thread_events` when a thread is affected

Store updates:

- runtime slice updates through subscriptions
- affected thread slices update through thread events

Important rule:

- runtime state is attached to chat on demand, not every turn

## Flow: Backend Restart Recovery

Trigger:

- backend process restarts

Backend:

- reconnect to or restart global `ov watch`
- reconnect to or restore project coordinators
- restart watchdog loops if necessary
- emit recovery success/failure events

DB:

- `project_runtimes`
- `runtime_components`
- `runtime_health_checks`
- `thread_events`

Store updates:

- runtime health snapshots refresh
- affected thread timelines gain recovery events
