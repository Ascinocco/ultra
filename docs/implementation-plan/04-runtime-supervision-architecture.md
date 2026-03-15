# Milestone 4 Architecture: Runtime Supervision

## Status

Draft v0.1

This document defines the architecture for Milestone 4 of Ultra: Runtime Supervision.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [04-runtime-supervision.md](/Users/tony/Projects/ultra/docs/implementation-plan/04-runtime-supervision.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)

## Purpose

Milestone 4 turns Ultra from a useful interface into a dependable execution environment.

By the end of this milestone, Ultra should be able to:

- supervise one long-lived coordinator per active project
- supervise one global `ov watch`
- run one lightweight watchdog per active project
- surface aggregate and component health
- recover or fail visibly after process interruptions

## Architectural Goals

Milestone 4 should optimize for:

- clear runtime ownership boundaries
- visible health and recovery state
- predictable restart policy
- minimal but real supervision

It should not optimize for:

- deep worker-level scheduling logic
- low-level ops console UX
- advanced machine-capacity management

## Runtime Topology

Milestone 4 should implement the product runtime topology for real:

- one Ultra backend process per machine
- one global `ov watch` process per machine
- one long-lived coordinator process per active project
- one watchdog loop per active project

### Rule

Ultra supervises outer runtime lifecycle.

Overstory supervises internal worker orchestration.

Do not collapse these responsibilities.

## Runtime Component Model

Milestone 4 should model runtime components explicitly.

Recommended component types:

- `backend`
- `ov_watch`
- `project_coordinator`
- `project_watchdog`

Each component should expose:

- identity
- scope
- status
- heartbeat
- restart count
- failure reason

## Backend Architecture

Milestone 4 backend should add:

- `RuntimeSupervisor`
- `RuntimeRegistry`
- `CoordinatorService`
- `WatchService`
- `WatchdogService`
- `RecoveryService`
- `RuntimeHealthService`

### Responsibilities

`RuntimeSupervisor`:

- start/stop/restart supervised processes
- apply restart policy
- emit health transitions

`RuntimeRegistry`:

- keep the canonical mapping of project to coordinator/watchdog records

`CoordinatorService`:

- ensure project coordinator exists
- route thread-start and thread-runtime actions into that coordinator

`WatchService`:

- manage global `ov watch`

`WatchdogService`:

- run and observe per-project watchdog loops

`RecoveryService`:

- rebuild runtime state after backend restart

`RuntimeHealthService`:

- compute aggregate project health from component health

## Project Coordinator Architecture

Each active project gets one long-lived coordinator process.

### Coordinator Rules

- one project, one coordinator
- coordinator may manage multiple active threads
- coordinator identity is distinct from thread identity
- coordinator restarts must not create new thread identities

### Coordinator Persistence

Milestone 4 should persist:

- coordinator ID
- coordinator instance ID
- process ID where useful
- last heartbeat
- restart count

## Global `ov watch` Architecture

Milestone 4 should treat `ov watch` as one global machine-scoped process.

### Why

- it supports all agents
- product model says it should only run once
- project duplication adds noise without value

### Rules

- start at backend boot or on first execution need
- persist global component record
- monitor health separately from project health

## Per-Project Watchdog Architecture

Milestone 4 should implement the watchdog as a lightweight supervised helper.

### Implementation Direction

A backend-launched bash script is acceptable in v1.

The backend should treat it as a runtime component, not as invisible glue.

### Watchdog Responsibilities

- detect coordinator inactivity while threads are active
- probe for stuck or silent runtime states
- emit health signals back to backend
- trigger restart/escalation when required by policy

### Watchdog Non-Responsibilities

- it does not own thread state
- it does not replace the coordinator
- it does not expose raw worker orchestration in the UI

## Health Architecture

Milestone 4 should implement two health layers:

- component health
- aggregate project runtime health

### Component Statuses

- `healthy`
- `degraded`
- `down`

### Aggregate Project Health

Computed from:

- coordinator status
- watchdog status
- any project-scoped runtime failures

### UI Consumption

The Chat page bottom-right status pane should consume:

- aggregate project runtime health
- component summaries
- latest degradation reason

## Restart Policy Architecture

Milestone 4 should implement real restart policy.

### Default Policy

- retry failed processes automatically
- apply capped retries with backoff
- degrade component state when threshold exceeded
- emit visible events when instability affects thread execution

### Recommended Stages

- immediate restart
- short-delay restart
- medium-delay restart
- degraded/down state with user-visible issue

The exact timings can be implementation-specific, but the policy needs to be explicit and testable.

## Recovery Architecture

Milestone 4 should implement recovery after backend restart.

### Required Flow

1. backend boots
2. reconnect or rediscover global `ov watch`
3. reconnect or recreate project coordinator records
4. restart watchdog loops if needed
5. restore runtime component health
6. emit recovery or failure events for affected threads/projects

### Rule

Threads must not be silently orphaned.

If recovery fails, that failure must become visible state.

## Thread Runtime Integration

Milestone 4 should connect runtime state to thread state without making thread state a direct process mirror.

### Required Behaviors

- thread start routes through project coordinator
- runtime failures can emit thread-level degradation or failure events
- recovery events can appear in thread timeline
- coordinator restarts increment thread restart visibility where relevant

### Rule

Thread lifecycle remains a product abstraction, not a process table dump.

## IPC Architecture For Milestone 4

Implement these IPC areas for real:

- `runtime.get_project_health`
- `runtime.get_project_runtime`
- `runtime.get_components`
- `runtime.restart_coordinator`
- `runtime.restart_watchdog`
- `runtime.retry_thread`
- `runtime.pause_project_runtime`
- `runtime.resume_project_runtime`
- `runtime.health_updated`
- `runtime.component_updated`
- `runtime.project_runtime_updated`

### Product Rule

These operations may exist in IPC even if the primary user path is through main chat rather than buttons.

## Persistence Architecture

Milestone 4 should implement these schema areas for real:

- `project_runtimes`
- `runtime_components`
- `runtime_health_checks`

It should also update:

- thread snapshots when runtime affects them
- thread events for restart/recovery/degradation

## Runtime Event Architecture

Milestone 4 should emit visible events for:

- coordinator restart requested
- coordinator restarted
- runtime degraded
- runtime recovered
- watchdog stall detected
- watchdog stall cleared
- recovery failed

These should feed:

- thread timelines where relevant
- project runtime status surfaces

## Error Handling Expectations

Milestone 4 should visibly handle:

- coordinator launch failure
- `ov watch` missing or failing
- watchdog failure
- restart-loop exhaustion
- recovery failure after backend restart

## Testing Strategy

Recommended test areas:

- coordinator restart policy
- watchdog heartbeat and inactivity detection
- global `ov watch` single-instance behavior
- runtime health aggregation
- backend restart and recovery flow
- runtime event emission into thread/project views

## Main Architectural Risks

### 1. Process Ownership Confusion

If Ultra and Overstory responsibilities blur, restart behavior will become unpredictable.

### 2. Overeager Watchdog Logic

False positives will destroy user trust if the watchdog restarts healthy coordinators too aggressively.

### 3. Invisible Recovery

If the system silently mutates runtime state after failure, users will not understand thread behavior.

## Locked Decisions For This Milestone

1. One coordinator per active project
2. One global `ov watch` per machine
3. One watchdog per active project
4. Ultra owns outer supervision and restart policy
5. Health is aggregate plus per-component
6. Recovery and restart are visible user events
7. The watchdog/backend probe contract uses JSON-line status reports with fixed fields and fixed polling intervals
8. Coordinators and `ov watch` launch from the backend with explicit environment shaping, working directories, and project metadata
9. Runtime telemetry in v1 is limited to health, restart, heartbeat, and failure reasons shown in existing status and log surfaces
