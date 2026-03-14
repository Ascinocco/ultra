# Milestone 4 Sprint Plan: Runtime Supervision

## Status

Draft v0.1

This document breaks Milestone 4 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [04-runtime-supervision.md](/Users/tony/Projects/ultra/docs/implementation-plan/04-runtime-supervision.md)
- [04-runtime-supervision-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/04-runtime-supervision-architecture.md)

## Sprint Goal

Deliver reliable outer-runtime supervision for Ultra so coordinators, `ov watch`, and watchdogs are started, monitored, restarted, and surfaced coherently.

## Definition of Done

Milestone 4 is done when:

- a project coordinator is supervised per active project
- one global `ov watch` is supervised for the machine
- one watchdog runs per active project
- runtime health appears in the status pane
- restart and recovery events are visible
- backend restart does not silently orphan active work

## Sprint Breakdown

### Sprint 1: Runtime Records and Registry

Goal:

Make runtime state explicit in persistence and memory.

Tasks:

- implement `project_runtimes`
- implement `runtime_components`
- implement `runtime_health_checks`
- build `RuntimeRegistry`
- build DTOs for runtime snapshots and component health

Exit criteria:

- backend can persist and load runtime component state
- project runtime snapshots are queryable

### Sprint 2: Coordinator Supervision

Goal:

Supervise one project coordinator per active project.

Tasks:

- implement `CoordinatorService`
- implement coordinator launch path
- persist coordinator identity and heartbeat data
- implement restart policy for coordinator failures
- emit runtime and thread events when coordinator restarts

Exit criteria:

- coordinators are started and restarted predictably
- one active project maps to one coordinator

### Sprint 3: Global `ov watch`

Goal:

Supervise `ov watch` as a single machine-level component.

Tasks:

- implement `WatchService`
- ensure single-instance `ov watch` lifecycle
- persist global runtime component record
- surface watch health in runtime APIs
- emit degradation events when `ov watch` fails

Exit criteria:

- only one `ov watch` runs
- the backend can detect and recover `ov watch` failure

### Sprint 4: Project Watchdog

Goal:

Add per-project stall detection.

Tasks:

- implement watchdog launch contract
- implement heartbeat/probe path from watchdog to backend
- detect idle vs suspect vs stuck states
- connect watchdog signals into runtime health
- emit visible events when watchdog detects trouble

Exit criteria:

- active project runtimes have watchdog coverage
- coordinator inactivity is detectable

### Sprint 5: Recovery and Runtime Events

Goal:

Make runtime disruption understandable and recoverable.

Tasks:

- implement `RecoveryService`
- reconnect to runtime components on backend startup
- rehydrate runtime state into memory
- emit recovery success/failure events
- update thread timelines when affected

Exit criteria:

- backend restart triggers visible recovery behavior
- thread/project state stays coherent after restart

### Sprint 6: Status UI and Hardening

Goal:

Expose runtime state cleanly and make it trustworthy.

Tasks:

- wire runtime health into bottom-right status pane
- show aggregate health and component summaries
- handle restart-loop exhaustion and degraded states
- test restart backoff logic
- test failure scenarios and user-visible messaging

Exit criteria:

- runtime health is visible and understandable
- degraded states are not silent

## Suggested Work Order

Recommended order:

1. runtime tables and registry
2. coordinator supervision
3. global `ov watch`
4. watchdog loop
5. recovery logic
6. status pane integration
7. hardening and tests

Do not wire user-visible health until component records and state transitions are stable.

## Deliverables by Layer

### Frontend

- runtime health selectors
- status pane wiring
- degraded/recovery state display

### Backend

- runtime supervisor
- coordinator service
- watch service
- watchdog service
- recovery service
- runtime health service

### Shared

- runtime DTOs
- health/status enums
- runtime event payloads

## Acceptance Checks

Use these checks before calling the milestone done:

- does each active project get one coordinator?
- is `ov watch` only started once?
- does each active project get a watchdog?
- do failures trigger restart policy?
- are degraded states visible in UI?
- does backend restart preserve or visibly recover runtime state?

## Main Risks During Execution

### 1. Flaky Supervision

If process detection and restart are unreliable, the whole milestone fails.

### 2. Watchdog Noise

If the watchdog is too sensitive, users will stop trusting the product.

### 3. Hidden Recovery Bugs

If runtime state looks healthy but thread state is stale, the UI will become misleading.

## Deferred To Milestone 5

- manual browser page
- automation browser
- artifact sharing

## Output of This Milestone

At the end of Milestone 4, Ultra should have a real runtime control plane rather than a best-effort execution shell.
