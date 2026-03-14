# Milestone 2 Sprint Plan: Chat and Thread Core

## Status

Draft v0.1

This document breaks Milestone 2 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [02-chat-and-thread-core.md](/Users/tony/Projects/ultra/docs/implementation-plan/02-chat-and-thread-core.md)
- [02-chat-and-thread-core-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/02-chat-and-thread-core-architecture.md)

## Sprint Goal

Deliver a real Chat page with multi-chat workflow, structured plan/spec approvals, explicit thread creation, and a live thread pane backed by durable thread snapshots and event history.

## Definition of Done

Milestone 2 is done when:

- users can create and manage many chats per project
- each chat has its own runtime config
- plan approval and spec approval work as structured steps
- users must explicitly confirm `start work`
- a thread is created durably from that flow
- thread list and thread detail are live and consistent
- thread event replay works from checkpoints

## Sprint Breakdown

### Sprint 1: Chat Data Model and Basic UI

Goal:

Make chats real and persistent.

Tasks:

- implement DB tables for chats, sessions, and messages
- implement `chats.create`
- implement `chats.list`
- implement `chats.get`
- implement `chats.rename`
- implement `chats.pin`
- implement `chats.archive`
- implement `chats.restore`
- build chat rail UI
- build active chat transcript shell
- wire normalized chat state into frontend store

Exit criteria:

- many chats per project work
- pin/archive/rename are persisted
- selecting chats swaps the active transcript correctly

### Sprint 2: Chat Config and Messaging

Goal:

Make chats configurable and conversational.

Tasks:

- implement `chats.update_config`
- implement chat header config controls for provider/model/thinking/perms
- implement `chats.send_message`
- implement message persistence
- implement chat message subscription
- render user and assistant messages in transcript

Exit criteria:

- each chat has its own config
- each chat persists transcript history
- live chat updates work

### Sprint 3: Structured Plan and Spec Approvals

Goal:

Make planning transitions explicit and reliable.

Tasks:

- add structured `message_type` support for plan/spec proposals and approvals
- implement `chats.approve_plan`
- implement `chats.approve_specs`
- build plan approval block UI
- build spec approval block UI
- enforce approval ordering rules in backend

Exit criteria:

- plan and spec approval steps are separate
- backend rejects invalid ordering
- UI reflects approval state clearly

### Sprint 4: Thread Creation Flow

Goal:

Cross the chat-to-thread boundary cleanly.

Tasks:

- implement `chats.start_thread`
- enforce explicit start-work confirmation
- create thread snapshot rows
- create initial thread event rows
- create chat-thread references
- build initial thread list population

Exit criteria:

- starting work creates a new thread
- thread appears in the right pane immediately
- thread creation is durable across restart

### Sprint 5: Thread Detail and Event Timeline

Goal:

Make thread detail a real execution surface.

Tasks:

- implement `threads.list_by_project`
- implement `threads.list_by_chat`
- implement `threads.get`
- implement `threads.get_events`
- implement `threads.events` subscription with replay
- build thread cards
- build thread detail shell
- build timeline tab
- build state badges and summary display
- add coordinator input dock shell

Exit criteria:

- thread cards update from snapshot changes
- timeline loads from persisted events
- replay from checkpoint works after reconnect

### Sprint 6: Hardening and Cross-Chat Stability

Goal:

Make the milestone stable enough to build review flow on top.

Tasks:

- test multi-chat switching with selected thread persistence
- test thread creation transactions
- test approval sequencing
- test subscription reconnect and replay
- handle not-found/state-conflict errors cleanly
- clean up loading/empty states

Exit criteria:

- thread and chat state stay stable under switching and reconnects
- error states are understandable
- the product flow feels coherent

## Suggested Work Order

Recommended order:

1. chat tables and repositories
2. chat rail and transcript shell
3. chat config and send-message path
4. structured plan/spec message types
5. approval APIs and UI
6. thread tables and repositories
7. `chats.start_thread`
8. thread list/detail
9. thread event replay subscriptions
10. hardening and tests

Do not start fake thread UI before durable thread tables and event append logic exist.

## Deliverables by Layer

### Frontend

- chat rail
- active chat pane
- chat config controls
- approval blocks
- thread pane
- thread list
- thread detail shell
- timeline tab

### Backend

- chat services
- message persistence
- approval enforcement
- thread creation transaction
- thread event append
- thread projection updates
- thread event replay subscription

### Shared

- chat DTOs
- thread DTOs
- approval payload types
- thread event DTOs

## Acceptance Checks

Use these checks before calling the milestone done:

- can I create several chats in one project?
- can I pin/archive/rename chats?
- can each chat have a different runtime config?
- can I approve a plan and then specs?
- does the system require explicit start-work confirmation?
- does a thread appear and persist after creation?
- does the timeline survive reconnects and reloads?

## Main Risks During Execution

### 1. Unstructured Approval Flow

If approval state is not modeled explicitly, the UI will drift into guesswork.

### 2. Thread Detail Built Too Early

If the UI is built before event storage and replay are correct, the surface will be unstable.

### 3. Overbuilding Runtime Behavior

Keep runtime behavior shallow here. Real supervision belongs in Milestone 4.

## Deferred To Milestone 3

- real Editor page review flow
- open in editor
- runtime file sync
- terminal and run/debug behavior

## Output of This Milestone

At the end of Milestone 2, Ultra should feel like a real chat-first command center with real execution threads, even if the full review and runtime hardening loop is not complete yet.
