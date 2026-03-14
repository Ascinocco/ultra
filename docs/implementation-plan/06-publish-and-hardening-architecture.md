# Milestone 6 Architecture: Publish and Hardening

## Status

Draft v0.1

This document defines the architecture for Milestone 6 of Ultra: Publish and Hardening.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [06-publish-and-hardening.md](/Users/tony/Projects/ultra/docs/implementation-plan/06-publish-and-hardening.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Milestone 6 closes the loop and hardens the product for daily use.

By the end of this milestone, Ultra should support:

- post-approval publish flow
- branch push
- draft PR creation
- publish state transitions
- publish failure handling
- data retention discipline
- performance cleanup for long-lived local usage

## Architectural Goals

Milestone 6 should optimize for:

- a clean separation between completion and publish
- visible and retryable publish failures
- bounded local data growth
- stable performance under real usage

It should not optimize for:

- multi-user workflows
- complex release automation beyond draft PRs
- cloud infrastructure

## Core Publish Boundary

This milestone depends on one product rule:

- thread completion happens after user approval
- publish is a separate lifecycle

Architecture should preserve that distinction.

Do not let publish success become the only source of thread completion truth.

## Publish Architecture

Milestone 6 backend should add:

- `PublishService`
- `GitPublishService`
- `PullRequestService`

### Responsibilities

`PublishService`:

- orchestrate publish workflow after approval
- update publish state
- emit publish events

`GitPublishService`:

- push branch
- validate branch state
- handle local Git publish errors

`PullRequestService`:

- create draft PR
- attach thread metadata to PR payload
- capture PR identifiers and URLs

## Publish Flow

Recommended flow:

1. thread is approved and completed
2. publish is requested
3. publish state transitions to `publishing`
4. branch push occurs
5. draft PR creation occurs
6. publish state transitions to `published` or `publish_failed`

### Rule

Each step should produce durable events and snapshot updates.

## Publish Configuration Architecture

Milestone 6 should implement project-level publish templates for:

- branch names
- commit messages
- PR titles
- PR bodies

These should come from `project_settings`.

### Rule

Use template-driven configuration, not hard-coded naming logic spread across services.

## Publish Failure Architecture

Publish failures should be first-class states, not generic task failures.

### Failure Examples

- push rejected
- auth failure
- branch missing
- PR API failure
- malformed template output

### Required Response

- persist failure reason
- emit publish failure event
- keep thread state coherent
- allow retry path

## Event Architecture

Milestone 6 should implement and rely on:

- `thread.publish_requested`
- `thread.publish_started`
- `thread.pr_opened`
- `thread.publish_succeeded`
- `thread.publish_failed`
- `thread.publish_state_changed`

### Rule

Thread timeline should clearly explain whether:

- work is approved but unpublished
- publish is in progress
- publish failed
- publish succeeded

## Persistence Architecture

Milestone 6 should finalize persistence around:

- PR metadata on thread snapshot
- publish state updates
- artifact/log retention behavior

### Retention Strategy

Milestone 6 should implement a real policy for:

- raw thread logs
- runtime health history
- large artifacts

### Rule

Structured milestone events remain durable.

Raw logs and oversized transient data may be compacted or pruned.

## Performance Hardening Architecture

By Milestone 6, the app should assume:

- many chats
- large transcripts
- many threads
- long thread timelines
- retained artifacts and logs

### Required Architecture Moves

- paginate or window large reads
- avoid loading full logs into initial views
- use replay checkpoints and incremental updates
- keep list queries snapshot-based and lightweight

## IPC Architecture For Milestone 6

Implement or finish:

- `threads.publish`
- publish-related runtime/progress updates
- artifact and log fetch pagination where needed

If needed, add:

- `threads.retry_publish`
- `artifacts.list_by_thread` pagination
- `threads.get_logs` pagination parameters

## Frontend Architecture

Milestone 6 frontend should add:

- publish state UI in thread detail and cards
- retry-publish affordance where needed
- publish failure messaging
- retention-aware log and artifact loading patterns

### Rule

Do not let publish details overwhelm the main thread experience.

Publish should be visible, but still secondary to execution and review.

## Testing Strategy

Recommended test areas:

- publish happy path
- push failure behavior
- draft PR creation failure behavior
- idempotent retry behavior
- template rendering
- large-data loading behavior
- log retention and compaction behavior

## Main Architectural Risks

### 1. Completion/Publish Coupling

If these states are conflated, thread UX becomes confusing.

### 2. Last-Step Failure Messaging

If publish fails and the error is vague, the user will distrust the entire loop.

### 3. Data Growth

Without retention and pagination discipline, the product will degrade quickly under daily use.

## Locked Decisions For This Milestone

1. Publish remains separate from completion
2. Draft PR creation is part of the normal publish flow
3. Publish failures are explicit and retryable
4. Structured events remain durable while raw logs can be compacted

## Open Follow-Ups

1. exact PR provider integration details
2. exact log retention thresholds
3. whether some publish metadata should move into a dedicated table later
