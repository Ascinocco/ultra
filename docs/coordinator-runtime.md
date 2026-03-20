**DEPRECATED:** This document described the external Overstory coordinator model which has been replaced by Ultra's internal orchestration layer. See `docs/superpowers/specs/2026-03-19-agent-orchestration-layer-design.md` for the current architecture. The thread event payload definitions from this document have been absorbed into `thread-event-schema.md`.

# Ultra Coordinator Runtime

## Status

Draft v0.2

This document is the normative v1 contract for how the Ultra backend supervises project coordinators and exchanges control traffic with them.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [wiring/runtime-wiring.md](/Users/tony/Projects/ultra/docs/wiring/runtime-wiring.md)
- [examples/coordinator-ndjson-examples.md](/Users/tony/Projects/ultra/docs/examples/coordinator-ndjson-examples.md)

## Purpose

Ultra needs a coordinator contract that is:

- specific enough for `RuntimeSupervisor`, `CoordinatorService`, and recovery work to implement without reopening protocol questions
- durable enough to survive process restart and backend recovery
- observable enough to explain thread behavior and runtime degradation
- narrow enough that Ultra still supervises Overstory instead of reimplementing it

This document is the source of truth for coordinator transport, envelopes, command names, event names, identifiers, and persistence ownership in v1.

## Runtime Topology

Ultra runtime is composed of:

- one Ultra backend process per machine
- one global `ov watch` process per machine
- one long-lived project coordinator process per active project
- one per-project watchdog loop per active project coordinator
- many Overstory-managed workers behind the coordinator

### Responsibility Split

Ultra owns:

- outer process supervision
- command routing
- health checks
- restart policy
- SQLite persistence
- thread and runtime projections
- recovery after backend restart

Overstory owns:

- execution orchestration behind the project coordinator
- worker fan-out
- internal task execution semantics

User-facing rule:

- Ultra exposes one coordinator conversation per thread
- Overstory workers remain an implementation detail unless the user explicitly opens deeper diagnostics
- the coordinator is the stable execution identity even if worker makeup changes underneath it

## Project Coordinator Model

Each active project gets one long-lived coordinator process.

Coordinator rules:

- one project has one stable `coordinator_id`
- one coordinator may manage multiple active threads concurrently
- coordinator restarts create a new `coordinator_instance_id`
- coordinator restarts must not create new thread identities
- the backend persists coordinator identity and instance metadata separately from thread identity

Recommended persisted metadata:

- `project_id`
- `coordinator_id`
- `coordinator_instance_id`
- `coordinator_pid`
- `started_at`
- `last_heartbeat_at`
- `restart_count`
- `status`

## Global `ov watch`

`ov watch` is a machine-scoped Overstory helper process.

Rules:

- exactly one global `ov watch` process per machine in v1
- the Ultra backend starts and supervises it
- it does not share the coordinator transport
- its health is surfaced separately from project-scoped coordinator health

## Per-Project Watchdog

Ultra runs one lightweight watchdog loop per active project coordinator.

Rules:

- one watchdog per active project coordinator
- the watchdog is backend-launched and backend-supervised
- it uses its own helper path and does not share the coordinator stdio transport
- it emits health signals back to the backend only
- it never owns thread state and never writes SQLite directly

Cadence:

- every `60 seconds` while active work exists
- every `5 minutes` while the project runtime is idle

## Transport Contract

The backend launches the coordinator as a project-scoped child process and exchanges UTF-8 newline-delimited JSON over the child process `stdin` and `stdout`.

Transport rules:

- every message is exactly one JSON object per line
- wire keys are `snake_case`
- `stderr` is diagnostics only and never product state
- the backend owns startup, shutdown, restart, and correlation
- the watchdog remains on its own helper transport

### Protocol Version

The coordinator contract is locked to:

- `protocol_version: "1.0"`

## Envelope Shapes

### Command Envelope

Commands sent from backend to coordinator must contain:

- `kind`
- `protocol_version`
- `request_id`
- `command`
- `project_id`
- optional `thread_id`
- optional `coordinator_id`
- `payload`

### Response Envelope

Responses sent from coordinator to backend must contain:

- `kind`
- `protocol_version`
- `request_id`
- `ok`
- optional `result`
- optional `error`

If `ok` is `false`, `error` must contain:

- `code`
- `message`
- optional `details`

### Event Envelope

Events sent from coordinator to backend must contain:

- `kind`
- `protocol_version`
- `event_id`
- `sequence_number`
- `event_type`
- `project_id`
- `coordinator_id`
- `coordinator_instance_id`
- optional `thread_id`
- `occurred_at`
- `payload`

## Ordering and Identity Rules

- `request_id` correlates one command with one response
- `sequence_number` is monotonic within one `coordinator_instance_id`
- a restarted coordinator gets a new `coordinator_instance_id`
- a restarted coordinator resets `sequence_number` back to `1`
- backend deduplication and replay keys off `coordinator_instance_id + sequence_number`
- `coordinator_id` is stable for the project runtime, while `coordinator_instance_id` changes over time

## Required v1 Commands

The v1 command surface is:

- `hello`
- `ping`
- `get_runtime_status`
- `start_thread`
- `send_thread_message`
- `retry_thread`
- `pause_project_runtime`
- `resume_project_runtime`
- `shutdown`

### `hello`

Payload:

- `backend_instance_id`
- `supported_protocol_versions`

Success result:

- `accepted_protocol_version`
- `coordinator_id`
- `coordinator_instance_id`
- `coordinator_version`
- `capabilities`

`capabilities` should contain at least:

- `supports_thread_retry`
- `supports_project_pause`
- `supports_project_resume`
- `supports_thread_messages`

### `ping`

Payload:

- empty object

Success result:

- `status`
- `checked_at`

### `get_runtime_status`

Payload:

- optional `include_threads`

Success result:

- `status`
- `last_heartbeat_at`
- `active_thread_ids`
- `queued_thread_ids`
- `active_agent_count`
- `restart_count`

### `start_thread`

Required envelope field:

- `thread_id`

Payload:

- `thread_title`
- `execution_summary`
- `spec_markdown`
- `ticket_refs`
- `chat_refs`
- `checkout_context`
- `attachments`

Behavior rules:

- idempotent by `thread_id`
- repeated delivery must not create duplicate thread execution
- durable state changes are projected from events, not from the response

Success result:

- `accepted`
- `queued`
- optional `message`

### `send_thread_message`

Required envelope field:

- `thread_id`

Payload:

- `message_id`
- `role`
- `content_markdown`
- `attachments`

Success result:

- `accepted`
- optional `message`

### `retry_thread`

Required envelope field:

- `thread_id`

Payload:

- `reason`
- optional `checkpoint_id`

Success result:

- `accepted`
- optional `message`

### `pause_project_runtime`

Payload:

- `reason`

Behavior rules:

- project-scoped only
- idempotent

Success result:

- `accepted`
- optional `message`

### `resume_project_runtime`

Payload:

- `reason`

Behavior rules:

- project-scoped only
- idempotent

Success result:

- `accepted`
- optional `message`

### `shutdown`

Payload:

- `graceful`
- `reason`

Success result:

- `accepted`
- optional `message`

## Response Error Codes

Coordinator responses may return only these fixed v1 error codes:

- `invalid_request`
- `unsupported_protocol_version`
- `thread_not_found`
- `runtime_unavailable`
- `busy`
- `not_supported`
- `internal_error`

Behavior rules:

- `unsupported_protocol_version` is returned before any command-specific handling
- retry, pause, resume, and shutdown never mutate SQLite directly
- all SQLite-facing product effects come from backend projection of coordinator events

## Required v1 Events

The coordinator must emit these events:

- `heartbeat`
- `runtime_status_changed`
- `thread_execution_state_changed`
- `thread_blocked`
- `thread_message_emitted`
- `thread_review_ready`
- `thread_agent_started`
- `thread_agent_progressed`
- `thread_agent_finished`
- `thread_agent_failed`
- `thread_log_chunk`
- `error`

### `heartbeat`

Payload:

- `status`
- `last_heartbeat_at`
- `active_thread_ids`
- `active_agent_count`

Backend projection:

- update `project_runtimes`
- update `runtime_components`
- append or update `runtime_health_checks`

### `runtime_status_changed`

Payload:

- `from_status`
- `to_status`
- `reason`
- `restart_count`

Backend projection:

- update runtime component state
- recompute aggregate project runtime health
- emit runtime-facing subscription updates

### `thread_execution_state_changed`

Payload:

- `from_state`
- `to_state`
- `reason`

Backend projection:

- update thread snapshot execution state
- append `thread.execution_state_changed`

### `thread_blocked`

Payload:

- `blocked_reason`
- `requires_user_input`
- optional `checkpoint_id`

Backend projection:

- update thread blocked state
- append `thread.blocked`

### `thread_message_emitted`

Payload:

- `message_id`
- `role`
- `message_type`
- `content_markdown`
- optional `attachments`

Backend projection:

- append to `thread_messages`
- append a thread event only when the message implies a state change or milestone

### `thread_review_ready`

Payload:

- `worktree_path`
- `branch_name`
- `base_branch`
- `commit_id`
- `changed_file_count`

Backend projection:

- update thread review-ready snapshot fields
- append `thread.review_ready`

### `thread_agent_started`

Payload:

- `agent_id`
- `agent_type`
- `display_name`
- optional `parent_agent_id`
- optional `work_item_ref`

Backend projection:

- update thread agent projection
- append `thread.agent_started`

### `thread_agent_progressed`

Payload:

- `agent_id`
- `summary`
- `progress_state`

Backend projection:

- update thread agent projection
- append `thread.agent_progressed`

### `thread_agent_finished`

Payload:

- `agent_id`
- `summary`
- `result`

Backend projection:

- update thread agent projection
- append `thread.agent_finished`

### `thread_agent_failed`

Payload:

- `agent_id`
- `summary`
- `error_code`
- `error_message`

Backend projection:

- update thread agent projection
- append `thread.agent_failed`

### `thread_log_chunk`

Payload:

- `stream`
- optional `agent_id`
- optional `agent_type`
- `chunk`
- `chunk_index`

Backend projection:

- append `thread.log_chunk`
- expose through logs and diagnostics views, not the main milestone timeline

### `error`

Payload:

- `scope`
- `code`
- `message`
- optional `details`
- `retryable`

Backend projection:

- update runtime health
- if `thread_id` is present, append a thread recovery or failure event, or equivalent visible thread state change

## Persistence Rule

The coordinator must never write directly into Ultra SQLite.

The backend is the only writer for:

- `threads`
- `thread_events`
- `thread_messages`
- `thread_agents`
- `project_runtimes`
- `runtime_components`
- `runtime_health_checks`

Coordinator output is always projected through backend-owned persistence and replay logic.

## Health and Recovery Rules

The backend should treat coordinator signals at two levels:

- project aggregate runtime health
- per-component health

Runtime component state should include at least:

- `component_id`
- `component_type`
- `status`
- `checked_at`
- `last_heartbeat_at`
- `restart_count`
- `reason`

On backend restart:

- attempt to reconnect or restart global `ov watch`
- attempt to reconnect or recreate each known project coordinator
- re-establish watchdog loops where needed
- rebuild aggregate runtime health
- emit recovery success or failure into runtime and thread projections when user work is affected

## Locked Decisions

1. One project has one stable coordinator identity.
2. One coordinator instance may manage multiple active threads concurrently.
3. One restarted coordinator gets a new `coordinator_instance_id` and a fresh event sequence.
4. The backend owns command correlation, deduplication, persistence, and replay.
5. The watchdog never shares the coordinator transport.
6. `stderr` remains diagnostics only.
7. `start_thread` is idempotent by `thread_id`.
8. Runtime control commands are explicit backend operations even when exposed only through chat.
9. Runtime instability must become visible state through backend projections rather than raw process output.
