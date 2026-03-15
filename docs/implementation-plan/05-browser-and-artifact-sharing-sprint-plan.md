# Milestone 5 Sprint Plan: External QA and Artifact Handoff

## Status

Draft v0.1

This document breaks Milestone 5 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [05-browser-and-artifact-sharing.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing.md)
- [05-browser-and-artifact-sharing-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing-architecture.md)

## Sprint Goal

Deliver reliable external handoff and artifact sharing so Ultra can stay focused on the chat-plus-terminal loop while still supporting browser, editor, and GitHub-based follow-up work when needed.

## Definition of Done

Milestone 5 is done when:

- handoff to browser/editor/GitHub is available from the correct worktree context
- runtime artifacts can be shared into chats and threads
- `Share All Context` works for terminal/runtime debugging
- any optional browser helpers remain clearly secondary to the core workflow

## Sprint Breakdown

### Sprint 1: Handoff Actions

Goal:

Create stable external handoff actions from the active worktree context.

Tasks:

- build `Open in Editor`
- build `Open in Browser`
- build `Open in GitHub`
- ensure each action resolves from the active project/worktree/thread context

Exit criteria:

- user can leave Ultra for focused external work without losing context

### Sprint 2: Runtime Artifact Capture

Goal:

Make terminal and runtime capture real.

Tasks:

- implement terminal output capture
- implement runtime log capture
- normalize captures into artifact bundles
- store artifact metadata

Exit criteria:

- capture actions produce structured artifact bundles

### Sprint 3: Destination Selection and Sharing

Goal:

Send artifacts into chats and threads predictably.

Tasks:

- implement destination picker
- implement share-to-chat
- implement share-to-thread
- render shared artifacts in chat/thread transcripts

Exit criteria:

- artifacts arrive in the correct context
- destination is always visible before send

### Sprint 4: `Share All Context`

Goal:

Make the debugging workflow high leverage.

Tasks:

- implement runtime `Share All`
- bundle terminal, runtime, and selected thread context
- add summary generation before attach if needed
- handle large bundle truncation/compaction rules

Exit criteria:

- one action can send the useful runtime debugging context

### Sprint 5: Optional Browser Helpers

Goal:

Add browser convenience only if it still fits the lightweight handoff model.

Tasks:

- evaluate whether a small browser helper is still needed
- if yes, keep it handoff-oriented and non-core
- if no, explicitly defer embedded browser work
- add tests for handoff and share flows

Exit criteria:

- browser work remains optional and does not become a prerequisite for the milestone

## Suggested Work Order

Recommended order:

1. external handoff actions
2. runtime artifact capture
3. destination selection and share flows
4. `Share All Context`
5. optional browser helpers
6. hardening and tests

Do not start heavyweight browser embedding work before the handoff model proves insufficient.

## Deliverables by Layer

### Frontend

- handoff actions
- destination picker
- share controls
- artifact rendering in transcript surfaces

### Backend

- artifact capture service
- artifact share service
- context-aware handoff helpers where needed

### Shared

- artifact DTOs
- share destination payloads
- handoff payloads

## Acceptance Checks

Use these checks before calling the milestone done:

- can I open the active worktree in my external editor?
- can I open the relevant branch or PR in GitHub?
- can I share terminal/runtime output into a chat?
- can I share terminal/runtime output into a thread?
- does `Share All Context` include the useful runtime debugging state?
- is browser work still clearly optional?

## Main Risks During Execution

### 1. Context Loss

If handoff actions do not carry the correct worktree or branch context, users will stop trusting them.

### 2. Oversharing

If artifact bundles are too large, the product will feel noisy and expensive.

### 3. Scope Creep

If this milestone grows back into an embedded browser/editor effort, the roadmap loses its simplification.

## Deferred To Milestone 6

- publish flow completion
- draft PR hardening
- retention policy cleanup

## Output of This Milestone

At the end of Milestone 5, Ultra should feel like a focused chat-plus-terminal workflow that can still hand off cleanly to outside tools and share the right debugging context back into the product.
