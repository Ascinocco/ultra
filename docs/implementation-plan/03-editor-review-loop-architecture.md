# Milestone 3 Architecture: Editor Review Loop

## Status

Draft v0.1

This document defines the architecture for Milestone 3 of Ultra: Editor Review Loop.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [03-editor-review-loop.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [artifact-sharing.md](/Users/tony/Projects/ultra/docs/artifact-sharing.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)

## Purpose

Milestone 3 should make review real.

By the end of this milestone, the user should be able to:

- move from a thread into the Editor page
- work inside the correct checkout
- get `.env` into that checkout
- open terminals in the right place
- run/debug in the right place
- request changes or approve the work

This is where Ultra proves it is not just a planning shell.

## Architectural Goals

Milestone 3 should optimize for:

- a simple and explicit editor target model
- predictable review flow from thread to editor
- minimal env/runtime-file friction
- terminal and run/debug behavior aligned to the active target
- clean thread review state transitions

It should not optimize for:

- advanced env management
- arbitrary multi-target layouts
- deeply custom editor engines

## Core Architecture Rule

The Editor page always operates on one active editor target.

That target is a concrete checkout path.

Branch is metadata on the target, not the primary object.

This rule should remain strict in Milestone 3.

## Editor Target Architecture

### Data Model

Milestone 3 should implement `editor_targets` as real DB-backed records.

Each target should include:

- `target_id`
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

`review_worktree` can remain deferred if not needed immediately.

### Selection Model

The frontend should track:

- current active editor target per project

Do not let target selection live only inside local component state.

## Frontend Architecture

### Store Expansion

Milestone 3 should add these slices:

- `editorTargets`
- `activeEditorTargetByProject`
- `runtimeProfiles`
- `runtimeSyncStatusByTarget`

Recommended shape:

```ts
type EditorState = {
  targetsById: Record<string, EditorTargetSnapshot>;
  targetIdsByProject: Record<string, string[]>;
  activeTargetIdByProject: Record<string, string | null>;
  runtimeProfileByProject: Record<string, ProjectRuntimeProfile>;
  runtimeSyncByTarget: Record<string, RuntimeSyncSnapshot>;
};
```

### UI Composition

Recommended Editor page composition:

- `EditorPage`
- `EditorTargetBar`
- `EditorTargetSelector`
- `EditorTargetMeta`
- `RuntimeSyncIndicator`
- `EditorWorkspaceHost`
- `EditorBottomPanel`
- `ReviewActionBar`

### Review Actions

The Editor page should provide:

- `Request Changes`
- `Approve`
- `Open Terminal`
- `Open Diff`
- `Open Changed Files`

These actions should be target-aware and thread-aware when the active target belongs to a thread.

## Backend Architecture

Milestone 3 backend should add:

- `EditorTargetService`
- `RuntimeProfileService`
- `RuntimeSyncService`
- `ReviewFlowService`

### Responsibilities

`EditorTargetService`:

- enumerate targets
- set active target
- open thread target in editor flow

`RuntimeProfileService`:

- read project runtime file config
- expose `.env` defaults

`RuntimeSyncService`:

- ensure required runtime files exist in target
- track sync status and metadata

`ReviewFlowService`:

- translate editor review actions into thread state changes

## `Open in Editor` Transition

This is the most important cross-page transition in Milestone 3.

### Required Flow

1. user triggers `Open in Editor` from thread or chat
2. backend resolves the target checkout for the thread
3. backend sets that target as active for the project
4. backend ensures runtime file sync for that target
5. frontend switches to Editor page
6. editor host loads the selected target

### Design Rule

Do not make `Open in Editor` a purely frontend navigation trick.

It should be a real operation because it changes target state and may trigger runtime file sync.

Recommended IPC command:

- `threads.open_in_editor`

## Runtime File Sync Architecture

Milestone 3 should implement the simple v1 rule:

- project runtime files default to `.env`
- sync mode defaults to managed copy

### Sync Flow

1. target becomes active
2. backend checks configured runtime files
3. backend copies missing or stale files into target
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

## Terminal and Run/Debug Architecture

Milestone 3 should unify terminal and run/debug around the active target path.

### Rules

- new terminals start with `cwd = active target path`
- run/debug launches use active target path as workspace root
- target metadata is available to launchers

### Product Boundary

Ultra does not need to build a custom terminal emulator.

It needs to ensure the existing terminal/debug surfaces are launched with the correct context.

## Thread Review State Architecture

Milestone 3 should implement the core review transitions:

- `awaiting_review` -> `in_review`
- `in_review` -> `changes_requested`
- `in_review` -> `approved`
- `approved` -> `completed`

### Recommended Behavior

- entering Editor from a review-ready thread may mark `review_state` to `in_review`
- requesting changes emits thread events and returns execution toward `running`
- approving emits thread approval and completion events

### Rule

Keep publish separate. Milestone 3 is about review, not branch publishing.

## IPC Architecture For Milestone 3

Implement these IPC areas for real:

- `editor.get_targets`
- `editor.get_active_target`
- `editor.set_active_target`
- `editor.open_terminal`
- `editor.open_diff`
- `editor.open_changed_files`
- `editor.sync_runtime_files`
- `threads.open_in_editor`
- `threads.request_changes`
- `threads.approve`

Recommended queries:

- `editor.get_runtime_profile`

Recommended subscriptions:

- `editor.active_target_updated`
- `editor.runtime_sync_updated`
- `threads.updated`

## Persistence Architecture

Milestone 3 should implement these tables for real:

- `editor_targets`
- `project_runtime_profiles`
- `target_runtime_syncs`

It should also update:

- `project_layout_state.last_editor_target_id`
- thread snapshot review fields
- thread events for review transitions

## Editor Host Architecture

Milestone 3 should treat the editor host as an integration boundary.

### Rule

Do not let review logic leak into the editor embedding layer.

The editor host should receive:

- active target path
- editor commands
- open-file/open-diff requests

The editor host should not decide:

- review state
- thread state transitions
- runtime sync policy

Those belong in the backend and app shell layers.

## Placeholder Strategy For Editor Embedding

If full Code-OSS embedding is not ready, Milestone 3 can still progress by:

- implementing target/state/control flows
- stubbing some editor host functions
- proving correct target selection and terminal/runtime behavior

But at least one real terminal and file-open path should be functional before calling the milestone done.

## Error Handling Expectations

Milestone 3 should visibly handle:

- target not found
- missing thread worktree
- runtime file sync failure
- terminal launch failure
- invalid review action for thread state

## Testing Strategy

Recommended test areas:

- active target switching
- `Open in Editor` flow
- `.env` sync behavior
- review state transitions
- request-changes returning thread to active execution path
- per-project target persistence

## Main Architectural Risks

### 1. Target Model Drift

If the implementation starts treating branch as the main object again, the review model will become confusing.

### 2. Leaky Editor Host Boundary

If the embedded editor becomes responsible for workflow state, later changes will be brittle.

### 3. Hidden Runtime Sync Behavior

If `.env` copy happens invisibly without visible status, debugging trust will suffer.

## Locked Decisions For This Milestone

1. Editor page uses one active target per project
2. Target is a concrete checkout path
3. `Open in Editor` is a real backend-backed operation
4. `.env` managed copy is the default runtime file strategy
5. New terminals and run/debug use the active target path
6. Review transitions are implemented before publish
7. The Editor page embeds a dedicated Code-OSS workbench surface inside the Ultra shell
8. Run and debug are provided through the embedded Code-OSS workbench and inherit the active target path
9. `review_worktree` remains deferred unless thread-owned worktrees prove to be a hard blocker during implementation
