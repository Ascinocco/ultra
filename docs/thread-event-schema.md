# Ultra Thread Event Schema

## Status

Draft v0.1

This document defines the durable event model for Ultra threads.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)

## Purpose

Thread events are the durable backend event stream for execution threads.

They exist to support:

- thread timeline rendering
- thread list status updates
- agent activity views
- approvals and review history
- publish history
- restart and recovery visibility
- backend recovery and replay

Thread events are not the only state store. Current thread state should still be available as a snapshot on the thread record.

## Core Model

Use two layers:

- `thread snapshot`: current materialized state for fast UI reads
- `thread events`: append-only history for audit, timeline, replay, and recovery support

### Product Rule

The UI should treat the thread snapshot as the source for current state and thread events as the source for history and explanations.

## Event Stream Rules

- events are append-only
- events are immutable after write
- ordering is canonical within a thread
- each thread has its own sequence space
- all important thread state transitions must emit events

## Event Envelope

Every thread event should contain:

- `event_id`
- `project_id`
- `thread_id`
- `sequence_number`
- `event_type`
- `occurred_at`
- `recorded_at`
- `actor_type`
- `actor_id`
- `source`
- `payload`

### Field Definitions

- `event_id`: stable unique ID for the event
- `project_id`: project owning the thread
- `thread_id`: owning thread
- `sequence_number`: per-thread monotonic ordering number
- `event_type`: typed event name
- `occurred_at`: when the event happened in the domain
- `recorded_at`: when Ultra persisted the event
- `actor_type`: origin category
- `actor_id`: origin identifier where available
- `source`: subsystem emitting the event
- `payload`: typed event body

## Ordering

Per-thread sequence order is the canonical ordering model for v1.

Timestamps are useful for display and debugging, but sequence number resolves ordering for one thread.

Ultra does not need a global project-wide event sequence in v1.

## Actor Types

Recommended actor types:

- `user`
- `chat`
- `thread`
- `coordinator`
- `worker`
- `backend`
- `watchdog`
- `system`

## Sources

Recommended sources:

- `ultra.backend`
- `ultra.chat`
- `ultra.thread`
- `ultra.review`
- `ov.coordinator`
- `ov.worker`
- `ov.watch`
- `git`
- `publish`

## Timeline Design Rule

The user-facing timeline should be milestone-oriented.

It should show:

- major state transitions
- important agent lifecycle milestones
- review and publish actions
- recovery and restart events
- user-visible errors and blockers

It should not show every raw output fragment.

### Detail Placement

- `Timeline`: milestone events only
- `Agents`: per-agent lifecycle and summaries
- `Logs`: raw stdout/stderr and process diagnostics

## Event Categories

### 1. Thread Lifecycle

- `thread.created`
- `thread.title_updated`
- `thread.summary_updated`
- `thread.completed`
- `thread.failed`
- `thread.canceled`

### 2. Execution State

- `thread.execution_state_changed`
- `thread.blocked`
- `thread.unblocked`
- `thread.review_ready`

### 3. Review State

- `thread.review_state_changed`
- `thread.review_started`
- `thread.changes_requested`
- `thread.approved`

### 4. Publish State

- `thread.publish_state_changed`
- `thread.publish_requested`
- `thread.publish_started`
- `thread.publish_succeeded`
- `thread.publish_failed`
- `thread.pr_opened`

### 5. Spec and Context Attachment

- `thread.specs_attached`
- `thread.ticket_refs_attached`
- `thread.chat_reference_added`
- `thread.thread_reference_added`

### 6. Checkout and Git

- `thread.worktree_created`
- `thread.worktree_ready`
- `thread.branch_created`
- `thread.commit_created`
- `thread.checkout_open_requested`

### 7. Agent Activity

- `thread.agent_started`
- `thread.agent_progressed`
- `thread.agent_finished`
- `thread.agent_failed`

### 8. Approval Flow

- `thread.approval_requested`
- `thread.approval_resolved`

### 9. Health and Recovery

- `thread.health_changed`
- `thread.coordinator_restart_requested`
- `thread.coordinator_restarted`
- `thread.recovered`
- `thread.recovery_failed`

### 10. Logs

- `thread.log_chunk`

## Required Event Semantics

### `thread.created`

Emitted when a thread is first created from a chat after explicit user approval to start work.

Minimum payload:

- `source_chat_id`
- `title`
- `initial_spec_ids`
- `initial_ticket_refs`
- `initial_execution_state`
- `initial_review_state`
- `initial_publish_state`

### `thread.execution_state_changed`

Emitted whenever execution state changes.

Payload:

- `from_state`
- `to_state`
- `reason`

### `thread.review_state_changed`

Emitted whenever review state changes.

Payload:

- `from_state`
- `to_state`
- `reason`

### `thread.publish_state_changed`

Emitted whenever publish state changes.

Payload:

- `from_state`
- `to_state`
- `reason`

### `thread.review_ready`

Emitted when the thread reaches review readiness.

Payload:

- `worktree_id`
- `worktree_path`
- `branch_name`
- `base_branch`
- `commit_id`
- `changed_file_count`

### `thread.changes_requested`

Emitted when the user requests follow-up work on the same thread.

Payload:

- `requested_by`
- `request_source`
- `summary`

This event should usually be followed by a `thread.review_state_changed` and `thread.execution_state_changed` transition back toward `running`.

### `thread.approved`

Emitted when the user approves the thread work.

Payload:

- `approved_by`
- `approval_source`
- `notes`

### `thread.completed`

Emitted when the user has approved the work and the thread is complete from Ultra's perspective.

Important rule:

- `thread.completed` may happen before publish begins or finishes

Payload:

- `completed_by`
- `completion_reason`

### `thread.publish_requested`

Emitted when the thread enters the publish flow.

Payload:

- `branch_name`
- `publish_mode`
- `target_remote`

### `thread.pr_opened`

Emitted when a draft PR is successfully opened.

Payload:

- `provider`
- `pr_url`
- `pr_number`
- `base_branch`
- `head_branch`

### `thread.coordinator_restarted`

Emitted when the coordinator process has restarted while the thread identity remains the same.

Payload:

- `restart_count`
- `reason`
- `previous_instance_id`
- `new_instance_id`

This event is projected from coordinator runtime-state changes plus backend restart detection. The stable project-scoped `coordinator_id` remains constant while `coordinator_instance_id` changes.

### `thread.recovered`

Emitted when Ultra successfully restores or rebinds thread state after backend or coordinator disruption.

Payload:

- `recovery_type`
- `summary`

This event should be emitted when backend recovery logic successfully rebinds a thread to a recovered coordinator instance or restored runtime state.

### `thread.recovery_failed`

Emitted when Ultra cannot restore the thread's runtime relationship after backend or coordinator disruption.

Payload:

- `recovery_type`
- `summary`
- `reason`

### `thread.log_chunk`

Emitted for raw output associated with the thread, coordinator, or a worker.

Payload:

- `stream`
- `agent_id`
- `agent_type`
- `chunk`
- `chunk_index`

`thread.log_chunk` exists for diagnostics and detailed inspection. It should not drive top-level timeline meaning.

Coordinator `thread_log_chunk` events project directly into this event shape. Missing `agent_id` or `agent_type` is allowed when the log is coordinator-scoped rather than worker-scoped.

## Main Chat Interaction Events

If a main chat action changes thread behavior, it must emit a thread event.

Examples:

- main chat asks to start review
- main chat requests changes on a thread
- main chat triggers open-in-editor for a thread
- main chat requests publish for a thread

This keeps thread history complete even when control originates outside thread detail.

## Agent Event Model

Agents should be visible only within the scope of their owning thread.

### Agent Timeline Rule

Do not flood the main timeline with all worker noise.

Preferred behavior:

- one event when an agent starts
- periodic summary/progress updates when meaningful
- one event when an agent finishes or fails

Detailed raw output belongs in logs.

### Recommended Agent Payload Fields

- `agent_id`
- `agent_type`
- `display_name`
- `parent_agent_id`
- `status`
- `summary`
- `work_item_ref`

Coordinator `thread_agent_started`, `thread_agent_progressed`, `thread_agent_finished`, and `thread_agent_failed` events should map directly into the agent projection and corresponding thread events without introducing a second naming scheme.

## Health and Recovery Visibility

Restart and recovery events should appear in the normal user-visible timeline.

Reason:

- users need to understand why a thread paused, resumed, or behaved unexpectedly

These are not merely operational diagnostics.

## Snapshot Projection

The backend should materialize thread snapshot fields from events plus direct execution state.

Minimum snapshot fields driven by events:

- latest execution state
- latest review state
- latest publish state
- latest summary
- latest health status
- current branch/worktree
- latest review-ready commit
- latest PR metadata
- restart count

## Retention Policy

Structured milestone events should be retained durably.

Raw log chunks are compacted or rotated under the defined retention policy.

### v1 Retention Rule

- keep structured events permanently in the local store
- compact, truncate, or archive `thread.log_chunk` records under the defined retention policy
- preserve enough metadata so the user can still see that logs once existed even if raw chunks are rotated

## Suggested Storage Shape

Recommended DB tables:

- `thread_events`
- `thread_event_logs`

Suggested split:

- `thread_events`: all structured milestone events
- `thread_event_logs`: large raw log chunks keyed to event metadata or agent metadata

This keeps replayable business events compact while allowing raw output to scale independently.

## Example Event Sequence

Example happy-path sequence:

1. `thread.created`
2. `thread.execution_state_changed` to `starting`
3. `thread.worktree_created`
4. `thread.branch_created`
5. `thread.execution_state_changed` to `running`
6. `thread.agent_started`
7. `thread.agent_progressed`
8. `thread.agent_finished`
9. `thread.review_ready`
10. `thread.execution_state_changed` to `awaiting_review`
11. `thread.review_state_changed` to `ready`
12. `thread.approved`
13. `thread.review_state_changed` to `approved`
14. `thread.completed`
15. `thread.publish_requested`
16. `thread.publish_state_changed` to `publishing`
17. `thread.pr_opened`
18. `thread.publish_succeeded`
19. `thread.publish_state_changed` to `published`

## Locked Decisions

1. Exact event payload schemas live in the shared validation package and are enforced by both IPC and persistence layers
2. The backend owns thread snapshot projection from append-only events
3. Thread streaming is exposed through `threads.events` with replay via `from_sequence`
4. Raw log rotation follows the hardening retention policy while structured milestone events remain durable
