# Ultra Coordinator Runtime

## Status

Draft v0.1

This document defines how Ultra supervises Overstory runtime processes and how project threads are mapped onto coordinator infrastructure.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)

## Purpose

Ultra needs a runtime model that is:

- simple enough for v1
- durable enough to recover from process failure
- observable enough to explain thread behavior
- lightweight enough that Ultra does not become a custom scheduler for Overstory internals

The product should supervise Overstory, not reimplement it.

## Runtime Topology

Ultra runtime is composed of:

- one Ultra backend process for the machine
- one global `ov watch` process for the machine
- one long-lived project coordinator process per active project
- one per-project watchdog loop for each active project coordinator
- many Overstory worker processes managed behind the coordinator/watch layer

## Responsibility Split

### Ultra Owns

- process supervision
- health checks
- restart policy
- thread records and thread event emission
- routing thread start/review/publish actions into project runtime
- recovery after backend restart

### Overstory Owns

- execution orchestration inside the project runtime
- worker fan-out
- worker coordination
- internal task execution semantics

### Product Rule

Ultra should not micromanage worker scheduling in v1.

Ultra should supervise outer lifecycle and let Overstory handle worker-level orchestration.

## Project Coordinator Model

Each active project gets one long-lived coordinator process.

### Why

- thread identity should survive process restarts
- multiple threads may exist concurrently for one project
- the user should think in project runtime terms, not ephemeral run-process terms

### Coordinator Rules

- coordinator is project-scoped
- coordinator is long-lived
- coordinator may manage multiple active threads concurrently
- coordinator restarts do not create new thread identities
- Ultra persists the coordinator identity and instance metadata separately from thread identity

### Recommended Coordinator Metadata

- `project_id`
- `coordinator_id`
- `process_id`
- `instance_id`
- `started_at`
- `last_heartbeat_at`
- `restart_count`
- `status`

## Global `ov watch`

`ov watch` is a utility provided by Overstory to help keep worker threads alive.

Ultra should run it once globally on behalf of the user.

### Rules

- exactly one global `ov watch` process per machine in v1
- it is not project-specific
- it should be started by the Ultra backend
- the backend should supervise and restart it if needed
- its health should be surfaced to the user when degraded or down

### Why Global

- `ov watch` supports all agents across projects
- per-project duplication would add unnecessary process noise
- the user should not need to reason about it unless it fails

## Per-Project Watchdog

Ultra should run a lightweight internal watchdog loop for each active project coordinator.

### Purpose

The watchdog exists to detect cases where the coordinator is alive but not making useful progress.

Examples:

- coordinator is stuck
- coordinator is inactive despite active thread work
- coordinator is failing to surface status updates
- project runtime needs a nudge or restart after inactivity

### v1 Implementation

For v1, a small backend-launched bash script is acceptable.

It should remain an internal implementation detail. The product contract is the watchdog behavior, not the script language.

### Watchdog Rules

- one watchdog per active project coordinator
- watchdog is started and monitored by the Ultra backend
- watchdog emits health/recovery signals back to the backend
- watchdog does not own thread state
- watchdog does not replace the coordinator

### Recommended Check Cadence

- when active work exists: check every 60 seconds
- when the project runtime is idle: check every 5 minutes

This is a good v1 default because it is frequent enough to catch stalls without creating constant overhead.

## Thread Routing

Threads are logical execution streams owned by Ultra and routed into the project coordinator.

### Thread Start Flow

1. chat completes plan approval and spec approval
2. user explicitly confirms `start work`
3. Ultra creates the thread record
4. Ultra emits `thread.created`
5. Ultra submits a `start_thread` request to the project coordinator
6. coordinator begins execution for that thread

### Important Rule

Threads are not the same as coordinator instances.

The coordinator is infrastructure. The thread is the product object.

## Concurrency Model

One project may have many threads.

One project has one coordinator.

The coordinator may manage multiple active threads concurrently.

Overstory may fan out as many workers as it wants behind that coordinator.

Ultra does not impose worker-level caps in the product model.

## Health Model

Ultra should track runtime health at two levels:

- aggregate project runtime health
- component health

### Aggregate Project Runtime Health

Project runtime health summarizes whether the project's execution system is healthy enough to continue work.

Statuses:

- `healthy`
- `degraded`
- `down`

### Component Health

Tracked components:

- Ultra backend
- global `ov watch`
- project coordinator
- project watchdog

Recommended health fields:

- `component_id`
- `component_type`
- `status`
- `checked_at`
- `last_heartbeat_at`
- `restart_count`
- `reason`

### Product Surface

Health should be visible in the UI, but not as an operations console with restart buttons.

It should answer:

- is the project runtime healthy?
- if not, which component is the problem?

## Restart Policy

Ultra owns outer restart behavior.

### Default Policy

- automatically restart failed coordinator/watch/watchdog processes
- use capped retries with backoff
- if restart attempts exceed threshold, mark component `degraded` or `down`
- emit thread/project health events when this happens

### Recommended v1 Backoff

- attempt 1: immediate
- attempt 2: after 5 seconds
- attempt 3: after 30 seconds
- attempt 4+: exponential backoff with degradation surfaced

Exact timings can be implementation-tuned later, but the product should assume bounded self-healing, not infinite restart loops.

## Stuck / Inactive Detection

The watchdog should distinguish between:

- legitimately idle coordinator
- active work with no recent progress
- coordinator process missing heartbeat
- coordinator producing no status while threads are active

### Recommended Signals

- time since last coordinator heartbeat
- time since last thread event
- count of active threads
- count of active worker tasks if available
- last successful status probe

### Suggested Heuristics

- `idle`: no active threads and no expected work
- `suspect`: active threads but no coordinator heartbeat or no meaningful progress for 5 minutes
- `stuck`: active threads and no useful progress for 10+ minutes, or repeated failed probes

These thresholds can later become configurable, but should start opinionated in v1.

## Recovery Model

Ultra backend restart should not silently orphan runtime state.

### On Backend Restart

- attempt to reconnect to global `ov watch`
- attempt to reconnect to each known active project coordinator
- re-establish watchdog processes where needed
- rebuild project runtime health
- emit recovery events when state is restored or when recovery fails

### Thread Behavior During Recovery

- thread identity remains stable
- active threads are rebound to recovered coordinator state when possible
- if recovery fails, threads emit visible recovery/failure events

## User Control Model

Ultra should not expose dedicated runtime-operation buttons such as `Restart Coordinator` in v1.

### Control Path

- the user asks from the main project chat
- the chat model can inspect project runtime state
- the chat model can reference the project coordinator automatically
- if needed, coordinator identifiers can still be visible in diagnostic surfaces

### Why

- this keeps the product chat-first
- it avoids exposing a low-level ops panel too early
- it preserves one clear control plane for the user

## Runtime Identifiers

The backend should persist enough identifiers for recovery, diagnostics, and chat-driven control.

Recommended runtime records:

- `project_runtime_id`
- `project_id`
- `coordinator_id`
- `coordinator_instance_id`
- `coordinator_pid`
- `watchdog_pid`
- `watchdog_status`
- `global_watch_pid`

The user does not need to memorize these, but the system should know them and make them inspectable.

## Suggested Data Model Additions

Recommended records:

- `project_runtimes`
- `runtime_components`
- `runtime_health_checks`

Recommended `project_runtimes` fields:

- `project_runtime_id`
- `project_id`
- `coordinator_id`
- `coordinator_instance_id`
- `status`
- `started_at`
- `last_heartbeat_at`
- `restart_count`

Recommended `runtime_components` fields:

- `component_id`
- `project_id`
- `component_type`
- `scope`
- `process_id`
- `status`
- `started_at`
- `last_heartbeat_at`
- `restart_count`
- `reason`

## Event Integration

The backend should emit runtime-related thread and project events when:

- coordinator starts
- coordinator restarts
- watchdog detects stall
- watchdog clears a stall
- recovery succeeds
- recovery fails
- `ov watch` becomes degraded or down

Thread-level events should be emitted when runtime state affects a thread's execution.

## Minimal v1 Operational Behavior

1. Start global `ov watch` at backend startup if not already healthy
2. Start project coordinator when project needs execution
3. Start per-project watchdog when coordinator becomes active
4. Route thread work into the coordinator
5. Monitor health and restart components as needed
6. Emit visible events when runtime instability affects user work
7. Let the main chat act as the primary control interface for runtime actions

## Locked Decisions

1. Each project has one long-lived coordinator process
2. `ov watch` is a single global supervised process
3. Ultra owns outer process supervision and restart behavior
4. Ultra runs one lightweight internal watchdog per active project
5. The coordinator may manage multiple threads concurrently
6. Project runtime health is shown as aggregate plus per-component status
7. Runtime operations are controlled primarily through chat, not explicit ops buttons

## Open Follow-Ups

1. exact coordinator command contract between backend and Overstory
2. exact watchdog probe logic and output format
3. exact persistence schema for runtime components and health checks
4. whether some runtime diagnostics should appear in a dedicated developer/debug view later
