# Milestone 4: Runtime Supervision

## Goal

Implement the real runtime control plane: long-lived project coordinators, global `ov watch`, per-project watchdogs, health modeling, restart policy, and recovery behavior.

## Why Fourth

The first three milestones prove the product shape. This milestone makes it dependable.

## Scope

- project runtime records
- long-lived coordinator process supervision
- global `ov watch` lifecycle
- per-project watchdog lifecycle
- aggregate and component health states
- restart and backoff policy
- recovery after backend restart
- runtime-related thread event emission
- chat-driven runtime control path

## Deliverables

- one coordinator per active project
- one global `ov watch`
- one watchdog per active project runtime
- health surfaced to Chat page status pane
- restart/recovery events visible in thread timelines when relevant
- backend can reconnect or recover after restart without silently orphaning threads

## Out of Scope

- deep Overstory internal scheduling control
- low-level ops dashboard with manual restart buttons
- advanced machine-level capacity planning

## Technical Decisions To Respect

- Ultra owns outer supervision
- Overstory owns worker orchestration
- runtime controls are invoked through chat UX, not dedicated ops UI
- restart and recovery are visible user events, not invisible internals

## Exit Criteria

- runtime components restart predictably after failure
- degraded states are visible
- active threads survive backend interruption with visible recovery behavior
- chat can issue backend runtime actions through the agreed IPC path

## Main Risks

- process supervision edge cases
- false positives in watchdog logic
- unclear recovery semantics leading to confusing user trust issues
