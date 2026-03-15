# Milestone 3 Sprint Plan: Worktree Terminal Workflow

## Status

Draft v0.1

This document breaks Milestone 3 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [03-editor-review-loop.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop.md)
- [03-editor-review-loop-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop-architecture.md)

## Sprint Goal

Deliver a real worktree-aware terminal loop so a user can move from a thread into the correct checkout, sync `.env`, run tests from an integrated terminal, and request changes or approve the work without leaving the chat workspace.

## Definition of Done

Milestone 3 is done when:

- a review-ready thread can make its worktree the active testing context
- the correct checkout becomes active
- `.env` is synced into that checkout
- terminal and saved commands use that checkout
- review actions work and update thread state correctly

## Sprint Breakdown

### Sprint 1: Worktree Context Model

Goal:

Make worktree contexts real and selectable.

Tasks:

- implement worktree context persistence
- implement `worktrees.list`
- implement `worktrees.get_active`
- implement `worktrees.set_active`
- add worktree slices to frontend store
- build shell worktree selector and metadata row

Exit criteria:

- active worktree persists per project
- selector switches cleanly between main checkout and thread worktrees

### Sprint 2: Terminal Drawer Shell

Goal:

Make the integrated terminal a first-class chat workspace surface.

Tasks:

- build terminal drawer shell
- implement `Open Terminal` from the top bar
- add session list and worktree labeling
- preserve terminal drawer open state in layout

Exit criteria:

- terminal drawer opens reliably from anywhere in the shell
- worktree context is visible before launching new sessions

### Sprint 3: Runtime File Sync

Goal:

Reduce worktree env friction.

Tasks:

- implement runtime profile records
- implement worktree runtime sync records
- implement `terminal.get_runtime_profile`
- implement `terminal.sync_runtime_files`
- default runtime file list to `.env`
- add runtime sync indicator
- add `Refresh runtime files`

Exit criteria:

- `.env` is copied into the active worktree
- sync status is visible

### Sprint 4: Terminal and Saved Commands

Goal:

Make the terminal workflow actually usable for testing.

Tasks:

- implement `terminal.open`
- ensure terminal launches with worktree cwd
- implement `terminal.run_saved_command`
- add default commands such as `test`, `dev`, `lint`, `build`
- show command output/session state in the terminal drawer

Exit criteria:

- terminals always open in the active worktree
- saved commands always respect the active worktree

### Sprint 5: Review Actions

Goal:

Make review decisions update thread state correctly.

Tasks:

- implement `threads.request_changes`
- implement `threads.approve`
- emit review-related thread events
- update thread snapshot projection
- build `Request Changes` and `Approve` actions in the chat/thread workflow
- show review state feedback in UI

Exit criteria:

- request changes returns thread toward active execution path
- approval marks the thread complete according to the product contract

### Sprint 6: Hardening and External Handoff

Goal:

Make the testing loop stable enough to use repeatedly.

Tasks:

- handle missing-worktree and missing-runtime-file errors
- test project switching while worktree selection persists
- test runtime sync failure states
- test review state transitions and replay
- add external handoff actions such as `Open in Editor` and `Open in GitHub`
- clean up empty states and shell affordances

Exit criteria:

- review flow survives normal edge cases
- user can trust what worktree they are operating in

## Suggested Work Order

Recommended order:

1. worktree persistence and store
2. shell worktree selector
3. terminal drawer shell
4. runtime file sync
5. terminal launch and saved commands
6. review state actions
7. hardening and tests

Do not wire approval UI before worktree selection and terminal targeting work correctly.

## Deliverables by Layer

### Frontend

- worktree selector and metadata
- terminal drawer
- runtime sync indicator
- saved command bar
- review action bar

### Backend

- worktree context services
- runtime file sync services
- terminal session service
- review transition service

### Shared

- worktree context DTOs
- runtime sync DTOs
- terminal session DTOs
- review action payloads

## Acceptance Checks

Use these checks before calling the milestone done:

- can I select a review-ready thread worktree?
- does the correct checkout become active?
- is `.env` present in the worktree after activation?
- do new terminal sessions open in the right path?
- do saved commands use the right path?
- can I request changes and see the thread update?
- can I approve and see the thread complete?

## Main Risks During Execution

### 1. Confusing Worktree Identity

If the user cannot tell what checkout is active, trust in the review loop will drop quickly.

### 2. Partial Terminal Targeting

If terminal and saved commands are inconsistent, the workflow will feel half-real.

### 3. Hidden `.env` Sync Semantics

The product should show sync status instead of silently mutating worktree state.

## Deferred To Milestone 4

- coordinator supervision depth
- global `ov watch`
- watchdog behavior
- runtime health and restart policies

## Output of This Milestone

At the end of Milestone 3, a user should be able to plan in Chat, create a thread, select its worktree, test it in the right terminal context, and drive the thread back for more work or complete it.
