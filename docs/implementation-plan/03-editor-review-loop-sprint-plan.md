# Milestone 3 Sprint Plan: Editor Review Loop

## Status

Draft v0.1

This document breaks Milestone 3 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [03-editor-review-loop.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop.md)
- [03-editor-review-loop-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop-architecture.md)

## Sprint Goal

Deliver a real Editor page and review loop so a user can move from a thread into a concrete checkout, run and debug in the correct path, sync `.env`, and request changes or approve the work.

## Definition of Done

Milestone 3 is done when:

- a review-ready thread can be opened in the Editor page
- the correct checkout becomes active
- `.env` is synced into that checkout
- terminals and run/debug use that checkout
- review actions work and update thread state correctly

## Sprint Breakdown

### Sprint 1: Editor Target Model

Goal:

Make editor targets real and selectable.

Tasks:

- implement `editor_targets` persistence
- implement `editor.get_targets`
- implement `editor.get_active_target`
- implement `editor.set_active_target`
- add editor target slices to frontend store
- build Editor page shell
- build target selector and target metadata row

Exit criteria:

- active target persists per project
- selector switches cleanly between targets

### Sprint 2: Open In Editor Flow

Goal:

Make thread-to-editor transition real.

Tasks:

- implement `threads.open_in_editor`
- resolve thread worktree target from thread record
- set active target on open
- navigate from Chat page to Editor page
- restore selected thread context in review UI

Exit criteria:

- `Open in Editor` takes the user to the right target
- selected thread remains clear during review

### Sprint 3: Runtime File Sync

Goal:

Reduce worktree env friction.

Tasks:

- implement `project_runtime_profiles`
- implement `target_runtime_syncs`
- implement `editor.get_runtime_profile`
- implement `editor.sync_runtime_files`
- default runtime file list to `.env`
- add runtime sync indicator
- add `Refresh runtime files`

Exit criteria:

- `.env` is copied into active thread target
- sync status is visible

### Sprint 4: Terminal and Run/Debug Alignment

Goal:

Make the editor environment actually usable for testing.

Tasks:

- implement `editor.open_terminal`
- ensure terminal launches with target cwd
- wire run/debug actions to active target root
- add changed-files and diff entry points
- expose `Open Changed Files`
- expose `Open Diff`

Exit criteria:

- terminals always open in the active target
- run/debug respects the active target

### Sprint 5: Review Actions

Goal:

Make review decisions update thread state correctly.

Tasks:

- implement `threads.request_changes`
- implement `threads.approve`
- emit review-related thread events
- update thread snapshot projection
- build `Request Changes` and `Approve` actions in Editor page
- show review state feedback in UI

Exit criteria:

- request changes returns thread toward active execution path
- approval marks the thread complete according to the product contract

### Sprint 6: Hardening and Review UX Cleanup

Goal:

Make the review loop stable enough to use repeatedly.

Tasks:

- handle target-not-found and missing-worktree errors
- test project switching while editor targets persist
- test runtime sync failure states
- test review state transitions and replay
- clean up empty states and review affordances

Exit criteria:

- review flow survives normal edge cases
- user can trust what target they are operating in

## Suggested Work Order

Recommended order:

1. editor target persistence and store
2. Editor page shell and selector
3. `threads.open_in_editor`
4. runtime file sync
5. terminal/run/debug targeting
6. review state actions
7. hardening and tests

Do not wire review approval UI before thread target resolution works correctly.

## Deliverables by Layer

### Frontend

- Editor page
- target selector and metadata
- runtime sync indicator
- review action bar
- terminal/diff/open-changed-files actions

### Backend

- editor target services
- runtime file sync services
- thread open-in-editor service
- review transition service

### Shared

- editor target DTOs
- runtime sync DTOs
- review action payloads

## Acceptance Checks

Use these checks before calling the milestone done:

- can I open a review-ready thread in the Editor page?
- does the correct checkout become active?
- is `.env` present in the target after activation?
- do new terminals open in the right path?
- do run/debug actions use the right path?
- can I request changes and see the thread update?
- can I approve and see the thread complete?

## Main Risks During Execution

### 1. Confusing Target Identity

If the user cannot tell what checkout is active, trust in the review loop will drop quickly.

### 2. Partial Run/Debug Support

If terminal and run/debug are inconsistent, the Editor page will feel half-real.

### 3. Hidden `.env` Sync Semantics

The product should show sync status instead of silently mutating target state.

## Deferred To Milestone 4

- coordinator supervision depth
- global `ov watch`
- watchdog behavior
- runtime health and restart policies

## Output of This Milestone

At the end of Milestone 3, a user should be able to plan in Chat, create a thread, open it in Editor, test it in the right checkout, and drive the thread back for more work or complete it.
