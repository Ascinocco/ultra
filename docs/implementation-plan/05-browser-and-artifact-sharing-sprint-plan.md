# Milestone 5 Sprint Plan: Browser and Artifact Sharing

## Status

Draft v0.1

This document breaks Milestone 5 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [05-browser-and-artifact-sharing.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing.md)
- [05-browser-and-artifact-sharing-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing-architecture.md)

## Sprint Goal

Deliver the Browser page, side browser, isolated automation browser path, and explicit artifact sharing from browser and runtime surfaces into chats and threads.

## Definition of Done

Milestone 5 is done when:

- the Browser page exists and is usable
- the side browser works from Chat and Editor
- the manual browser session persists
- automation browser runs are isolated from manual browsing
- browser/runtime artifacts can be shared into chats and threads
- `Share All Context` works

## Sprint Breakdown

### Sprint 1: Browser Page and Session Shell

Goal:

Create the Browser page and manual browser session shell.

Tasks:

- build Browser page
- build browser toolbar
- add URL navigation flow
- add persistent browser session/profile bootstrap
- add bookmark persistence shell

Exit criteria:

- user can browse in the Browser page
- browser session persists between app uses

### Sprint 2: Side Browser

Goal:

Embed browsing into Chat and Editor workflows.

Tasks:

- build side browser host
- implement open/close behavior
- implement resizable split
- persist side browser layout state
- wire side browser launch from Chat and Editor

Exit criteria:

- side browser works in both Chat and Editor
- split width and open state feel stable

### Sprint 3: Artifact Capture

Goal:

Make browser and runtime capture real.

Tasks:

- implement browser page capture actions
- implement browser console/network capture
- implement runtime output capture for managed terminals/run-debug
- normalize captures into artifact bundles
- store artifact metadata

Exit criteria:

- capture actions produce structured artifact bundles

### Sprint 4: Destination Selection and Sharing

Goal:

Send artifacts into chats and threads predictably.

Tasks:

- implement destination chip for side browser
- implement destination picker for Browser page
- implement share-to-chat
- implement share-to-thread
- render shared artifacts in chat/thread transcripts

Exit criteria:

- artifacts arrive in the correct context
- destination is always visible before send

### Sprint 5: `Share All` and Combined Debug Context

Goal:

Make the debugging workflow high leverage.

Tasks:

- implement browser `Share All`
- implement editor/runtime `Share All`
- implement combined `Share All Context`
- add summary generation before attach if needed
- handle large bundle truncation/compaction rules

Exit criteria:

- one action can send browser plus runtime debugging context together

### Sprint 6: Automation Browser and Hardening

Goal:

Add isolated QA automation and finish the milestone safely.

Tasks:

- implement automation browser session bootstrap
- attach QA artifacts to threads
- verify session isolation from manual browser
- handle browser/capture/share error states
- add tests for capture, share, and isolation

Exit criteria:

- automation browser runs are thread-scoped and isolated
- privacy boundary is preserved

## Suggested Work Order

Recommended order:

1. Browser page shell
2. manual browser session persistence
3. side browser
4. capture actions
5. destination selection and share flows
6. `Share All`
7. automation browser
8. hardening and tests

Do not start automation browser work before the manual browser/privacy boundary is stable.

## Deliverables by Layer

### Frontend

- Browser page
- side browser
- destination chip/picker
- share controls
- artifact rendering in transcript surfaces

### Backend

- manual browser service
- automation browser service
- artifact capture service
- artifact share service

### Shared

- artifact DTOs
- share destination payloads
- browser state DTOs

## Acceptance Checks

Use these checks before calling the milestone done:

- can I browse manually in Ultra?
- can I open a side browser from Chat and Editor?
- does the manual browser session persist?
- can I share page/log/network data into a chat?
- can I share runtime output into a thread?
- does `Share All Context` include both browser and runtime data?
- are automation browser sessions isolated from the manual browser?

## Main Risks During Execution

### 1. Browser Instability

If the embedded browser is flaky, this milestone may need tighter scoping quickly.

### 2. Oversharing

If artifact bundles are too large, the product will feel noisy and expensive.

### 3. Context Confusion

If users are unsure where a share is going, they will stop trusting the feature.

## Deferred To Milestone 6

- publish flow completion
- draft PR hardening
- retention policy cleanup

## Output of This Milestone

At the end of Milestone 5, Ultra should feel like a real all-in-one engineering and QA environment rather than only a planning and code-review surface.
