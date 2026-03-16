# Milestone 3 Architecture: Sandbox Terminal Workflow

## Status

Draft v0.2

This document defines the architecture for Milestone 3 of Ultra: Sandbox Terminal Workflow.

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

- select the correct sandbox for a thread or project
- get `.env` into that sandbox
- open or reuse a terminal in the right place
- run saved test or dev commands in the right place
- request changes or approve the work

This is where Ultra proves it is not just a planning shell.

## Architectural Goals

Milestone 3 should optimize for:

- a simple and explicit active sandbox model
- predictable review flow from thread to terminal
- minimal env and runtime-file friction
- terminal behavior aligned to the active sandbox
- clean thread review state transitions
- hidden Overstory and worktree complexity

It should not optimize for:

- embedded IDE complexity
- custom diff tooling
- advanced env management
- arbitrary multi-target layouts

## Core Architecture Rule

The shell always operates on one active sandbox context per project.

That context is a concrete checkout path.

Branch is metadata on the sandbox, not the primary object.

Internally, the sandbox may be backed by the project root or an Overstory-managed worktree. The frontend should not need to care.

## Sandbox Context Architecture

### Data Model

Milestone 3 should implement sandbox contexts as real DB-backed records.

Each context should include:

- `sandbox_id`
- `project_id`
- `thread_id`
- `path`
- `display_name`
- `sandbox_type`
- `branch_name`
- `base_branch`
- `is_main_checkout`
- `last_used_at`

### Types

Milestone 3 should support:

- `main_checkout`
- `thread_sandbox`

Review-only duplicate sandboxes can remain deferred.

### Selection Model

The frontend should track:

- current active sandbox per project

Do not let sandbox selection live only inside local component state.

## Frontend Architecture

### Store Expansion

Milestone 3 should add these slices:

- `projectSandboxes`
- `activeSandboxByProject`
- `runtimeSyncStatusBySandbox`
- `terminalSessions`
- `savedCommands`

Recommended shape:

```ts
type SandboxState = {
  sandboxesById: Record<string, SandboxContextSnapshot>;
  sandboxIdsByProject: Record<string, string[]>;
  activeSandboxIdByProject: Record<string, string | null>;
  runtimeSyncBySandbox: Record<string, RuntimeSyncSnapshot>;
  terminalSessionsByProject: Record<string, TerminalSessionSnapshot[]>;
  savedCommandsByProject: Record<string, SavedCommandSnapshot[]>;
};
```

### UI Composition

Recommended Chat workspace composition:

- `ProjectSidebar`
- `ChatPane`
- `ThreadPane`
- `SandboxSelector`
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

These actions should be sandbox-aware and thread-aware when the active sandbox belongs to a thread.

## Backend Architecture

Milestone 3 backend should add:

- `SandboxContextService`
- `RuntimeProfileService`
- `RuntimeSyncService`
- `TerminalSessionService`
- `ReviewFlowService`

### Responsibilities

`SandboxContextService`:

- enumerate available sandboxes
- set active sandbox
- resolve a thread sandbox from thread state

`RuntimeProfileService`:

- read project runtime file config
- expose `.env` defaults

`RuntimeSyncService`:

- ensure required runtime files exist in the active sandbox
- track sync status and metadata

`TerminalSessionService`:

- create or reuse terminal sessions for the selected sandbox
- launch saved commands in the active sandbox
- surface terminal session metadata back to the shell

`ReviewFlowService`:

- translate request-changes and approve actions into thread state changes

## `Open Terminal` Transition

This is the most important cross-surface transition in Milestone 3.

### Required Flow

1. user triggers `Open Terminal` from the top bar or thread UI
2. backend resolves the active sandbox for the project or thread
3. backend ensures runtime file sync for that sandbox
4. frontend opens or focuses the terminal drawer
5. terminal session loads in the selected sandbox

### Design Rule

Do not make `Open Terminal` a purely frontend visual toggle.

It should be a real operation because it resolves sandbox context and may trigger runtime file sync.

Recommended IPC commands:

- `sandboxes.get_active`
- `sandboxes.set_active`
- `terminal.open`
- `terminal.run_saved_command`

## Runtime File Sync Architecture

Milestone 3 should implement the simple v1 rule:

- project runtime files default to `.env`
- sync mode defaults to managed copy

### Sync Flow

1. sandbox becomes active or terminal launch is requested
2. backend checks configured runtime files
3. backend copies missing or stale files into the sandbox
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

Milestone 3 should unify terminal launch and repeatable commands around the active sandbox path.

### Rules

- new terminals start with `cwd = active sandbox path`
- saved command launches use active sandbox path as workspace root
- sandbox metadata is available to launchers
- changing the active sandbox affects new launches, not already-running sessions

### Product Boundary

Ultra does not need to build a custom terminal emulator.

It needs to ensure the terminal surface launches with the correct context and is easy to reach from the chat workspace.

## Thread Review State Architecture

Milestone 3 should implement the core review transitions:

- `awaiting_review` -> `in_review`
- `in_review` -> `running` on request changes
- `in_review` -> `approved` on approval

The thread remains the durable execution object. Review state should not move into the terminal service.

## Multiple Projects and Chats

Milestone 3 must respect the new shell model:

- many projects in the left sidebar
- chats nested under the active project
- right-side thread panel scoped to the active project or chat
- terminal sessions scoped per project, with sandbox labels per session

This means sandbox selection and terminal sessioning must stay project-aware by design.
