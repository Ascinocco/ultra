# Milestone 6 Sprint Plan: Publish and Hardening

## Status

Draft v0.1

This document breaks Milestone 6 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [06-publish-and-hardening.md](/Users/tony/Projects/ultra/docs/implementation-plan/06-publish-and-hardening.md)
- [06-publish-and-hardening-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/06-publish-and-hardening-architecture.md)

## Sprint Goal

Finish the end-to-end loop with reliable publish behavior and harden the product for real sustained usage.

## Definition of Done

Milestone 6 is done when:

- approved threads can publish branches and draft PRs
- publish state is visible and retryable
- publish failures are understandable
- large logs/artifacts are handled responsibly
- the app remains usable under realistic local data growth

## Sprint Breakdown

### Sprint 1: Publish Services and State Wiring

Goal:

Make publish a real lifecycle.

Tasks:

- implement `PublishService`
- implement publish state transitions
- implement publish-related thread events
- wire publish state into thread snapshots and UI

Exit criteria:

- thread publish lifecycle exists independently of execution/review

### Sprint 2: Git Push and Branch Publish

Goal:

Perform the local Git side of publishing.

Tasks:

- implement `GitPublishService`
- validate branch existence and readiness
- push branch
- handle push failures cleanly
- persist publish failure details

Exit criteria:

- branch publish works or fails with visible reasons

### Sprint 3: Draft PR Creation

Goal:

Finish the publish loop.

Tasks:

- implement `PullRequestService`
- render PR title/body from templates
- create draft PR
- persist PR URL/number/provider metadata
- emit PR-opened and publish-success events

Exit criteria:

- successful publish opens a draft PR and updates thread state

### Sprint 4: Retry and Failure UX

Goal:

Make last-step failures survivable.

Tasks:

- implement retry publish path
- build failure messaging UI
- add retry affordances
- preserve thread completion while publish is retried

Exit criteria:

- publish can fail without corrupting thread completion state
- retry is understandable

### Sprint 5: Retention and Pagination

Goal:

Prevent local state from degrading the product over time.

Tasks:

- implement log retention policy
- implement artifact retention or pruning rules
- add pagination/windowing to large logs and artifact lists
- ensure thread list/detail initial loads stay lightweight

Exit criteria:

- large local histories remain usable
- raw logs do not grow without bounds

### Sprint 6: Final Hardening

Goal:

Make the product feel daily-drivable.

Tasks:

- test end-to-end approval-to-publish flow
- test push/PR failure paths
- test publish retry behavior
- test large local data scenarios
- clean up edge-state UX and performance bottlenecks

Exit criteria:

- the full loop is stable enough for daily use

## Suggested Work Order

Recommended order:

1. publish state wiring
2. Git push path
3. draft PR creation
4. failure and retry UX
5. retention and pagination
6. final hardening and tests

Do not work on polish before publish failure semantics are correct.

## Deliverables by Layer

### Frontend

- publish status badges
- publish progress/failure messaging
- retry affordances
- log/artifact pagination UX

### Backend

- publish orchestration
- Git push integration
- draft PR integration
- retry handling
- retention jobs or compaction flow

### Shared

- publish DTOs
- PR metadata payloads
- paginated log/artifact response types

## Acceptance Checks

Use these checks before calling the milestone done:

- can I approve a thread and then publish it?
- does branch push work?
- does draft PR creation work?
- are publish failures visible and retryable?
- does thread completion remain coherent when publish fails?
- do large logs/artifacts still load sanely?

## Main Risks During Execution

### 1. Git and PR Edge Cases

Last-step failures often surface messy environment issues.

### 2. Retry Semantics

If retries are not idempotent enough, publish state will get confusing quickly.

### 3. Performance Drift

If retention and pagination land too late, the product will feel unstable right at the finish line.

## Deferred Beyond Milestone 6

- multi-user collaboration
- cloud sync
- richer release automation beyond draft PRs

## Output of This Milestone

At the end of Milestone 6, Ultra should support the full daily loop from planning to review to publish with enough hardening to be taken seriously as a working product.
