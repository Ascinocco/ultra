# Milestone 3 Architecture: Worktree Terminal Workflow

## Status

Draft v0.1

This document defines the architecture for Milestone 3 of Ultra: Worktree Terminal Workflow.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [03-editor-review-loop.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop.md)
- [worktree-terminal-model.md](/Users/tony/Projects/ultra/docs/worktree-terminal-model.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)

## Purpose

Milestone 3 should make testing and approval real.

By the end of this milestone, the user should be able to:

- select the correct checkout path for a thread or project
- get `.env` into that checkout
- open or reuse a terminal in the right place
- run saved test or dev commands in the right place
- request changes or approve the work

This is where Ultra proves it is not just a planning shell.

## Architectural Goals

Milestone 3 should optimize for:

- a simple and explicit active worktree model
- predictable review flow from thread to terminal
- minimal env/runtime-file friction
- terminal behavior aligned to the active worktree
- clean thread review state transitions

It should not optimize for:

- embedded IDE complexity
- custom diff tooling
- advanced env management
- arbitrary multi-target layouts

## Core Architecture Rule

The shell always operates on one active worktree context per project.

That context is a concrete checkout path.

Branch is metadata on the worktree, not the primary object.

This rule should remain strict in Milestone 3.

## Worktree Context Architecture

### Data Model

Milestone 3 should implement worktree contexts as real DB-backed records or a direct extension of the existing project/thread layout state, depending on what creates the lowest-churn persistence model.

Each context should include:

- `worktree_id`
- `project_id`
- `thread_id`
- `path`
- `display_name`
- `target_type`
- `branch_name`
- `base_branch`
- `is_main_checkout`
- `last_used_at`

### Types

Milestone 3 should support:

- `main_checkout`
- `thread_worktree`

Review-only duplicate worktrees can remain deferred.

### Selection Model

The frontend should track:

- current active worktree per project

Do not let worktree selection live only inside local component state.

## Frontend Architecture

### Store Expansion

Milestone 3 should add these slices:

- `projectWorktrees`
- `activeWorktreeByProject`
- `runtimeSyncStatusByWorktree`
- `terminalSessions`
- `savedCommands`

Recommended shape:

```ts
type WorktreeState = {
  worktreesById: Record<string, WorktreeContextSnapshot>;
  worktreeIdsByProject: Record<string, string[]>;
  activeWorktreeIdByProject: Record<string, string | null>;
  runtimeSyncByWorktree: Record<string, RuntimeSyncSnapshot>;
  terminalSessionsByProject: Record<string, TerminalSessionSnapshot[]>;
  savedCommandsByProject: Record<string, SavedCommandSnapshot[]>;
};
```

### UI Composition

Recommended Chat workspace composition:

- `ChatWorkspace`
- `WorktreeSelector`
- `TerminalLaunchButton`
- `ThreadReviewActions`
- `RuntimeSyncIndicator`
- `TerminalDrawer`
- `SavedCommandBar`

### Review Actions

The Chat workspace should provide:

- `Open Terminal`
- `Run Tests`
- `Run Dev`
- `Refresh runtime files`
- `Request Changes`
- `Approve`
- optional external handoff actions such as `Open in Editor` or `Open in GitHub`

These actions should be worktree-aware and thread-aware when the active worktree belongs to a thread.

## Backend Architecture

Milestone 3 backend should add:

- `WorktreeContextService`
- `RuntimeProfileService`
- `RuntimeSyncService`
- `TerminalSessionService`
- `ReviewFlowService`

### Responsibilities

`WorktreeContextService`:

- enumerate available worktrees
- set active worktree
- resolve a thread worktree from thread state

`RuntimeProfileService`:

- read project runtime file config
- expose `.env` defaults

`RuntimeSyncService`:

- ensure required runtime files exist in the active worktree
- track sync status and metadata

`TerminalSessionService`:

- create or reuse terminal sessions for the selected worktree
- launch saved commands in the active worktree
- surface terminal session metadata back to the shell

`ReviewFlowService`:

- translate request-changes and approve actions into thread state changes

## `Open Terminal` Transition

This is the most important cross-surface transition in Milestone 3.

### Required Flow

1. user triggers `Open Terminal` from the top bar or thread UI
2. backend resolves the active worktree for the project or thread
3. backend ensures runtime file sync for that worktree
4. frontend opens or focuses the terminal drawer
5. terminal session loads in the selected worktree

### Design Rule

Do not make `Open Terminal` a purely frontend visual toggle.

It should be a real operation because it resolves worktree context and may trigger runtime file sync.

Recommended IPC commands:

- `worktrees.get_active`
- `worktrees.set_active`
- `terminal.open`
- `terminal.run_saved_command`

## Runtime File Sync Architecture

Milestone 3 should implement the simple v1 rule:

- project runtime files default to `.env`
- sync mode defaults to managed copy

### Sync Flow

1. worktree becomes active or terminal launch is requested
2. backend checks configured runtime files
3. backend copies missing or stale files into the worktree
4. backend updates sync status
5. frontend shows sync status indicator

### Why Managed Copy

- simpler than symlink semantics
- works for common app setups
- minimizes early platform-specific edge cases

### Important Constraint

Drift is possible with copies.

That is acceptable in Milestone 3 as long as:

- sync status is visible
- `Refresh runtime files` exists

## Terminal and Saved Command Architecture

Milestone 3 should unify terminal launch and repeatable commands around the active worktree path.

### Rules

- new terminals start with `cwd = active worktree path`
- saved command launches use active worktree path as workspace root
- worktree metadata is available to launchers
- changing the active worktree affects new launches, not already-running sessions

### Product Boundary

Ultra does not need to build a custom terminal emulator.

It needs to ensure the terminal surface launches with the correct context and is easy to reach from the chat workspace.

## Thread Review State Architecture

Milestone 3 should implement the core review transitions:

- `awaiting_review` -> `in_review`
- `in_review` -> `changes_requested`
- `in_review` -> `approved`
- `approved` -> `completed`

### Recommended Behavior

- selecting a review-ready thread worktree may mark `review_state` to `in_review`
- requesting changes emits thread events and returns execution toward `running`
- approving emits thread approval and completion events

### Rule

Keep publish separate. Milestone 3 is about testing and approval, not branch publishing.

## IPC Architecture For Milestone 3

Implement these IPC areas for real:

- `worktrees.list`
- `worktrees.get_active`
- `worktrees.set_active`
- `terminal.open`
- `terminal.list_sessions`
- `terminal.run_saved_command`
- `terminal.sync_runtime_files`
- `threads.request_changes`
- `threads.approve`

Recommended queries:

- `terminal.get_runtime_profile`
- `terminal.get_saved_commands`
