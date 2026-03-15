# Ultra Editor Checkout Model

## Status

Draft v0.1

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [electron-host-boundaries.md](/Users/tony/Projects/ultra/docs/electron-host-boundaries.md)

This document defines how the Ultra editor page should handle repositories, worktrees, branches, terminals, runtime files, and run/debug behavior for thread review and manual coding.

## Purpose

Ultra has two primary product areas:

- `Chat page`: project-level planning, ticket intake, research, specs, and thread creation
- `Editor page`: concrete code inspection, file editing, terminal usage, run/debug, and review

The editor page should make parallel work easy to inspect and test without forcing the user to reopen projects manually or recreate environment files repeatedly.

## Core Principle

The editor page always has exactly one active editor target.

An active editor target is a concrete filesystem checkout path for the current project.

Ultra should not make `branch` the top-level editor abstraction. The editor operates on a real checkout path, and branch is metadata on that checkout.

## Editor Target

### Definition

An editor target is a concrete checkout of a project that Ultra can open in the editor page.

In v1, an editor target may be:

- the main project checkout
- a thread-owned worktree
- a manually created review worktree

Each editor target should expose:

- `target_id`
- `project_id`
- `path`
- `display_name`
- `target_type`
- `branch_name`
- `base_branch`
- `is_main_checkout`
- `thread_id`
- `created_at`
- `last_used_at`
- `runtime_sync_status`

### Target Types

- `main_checkout`
- `thread_worktree`
- `review_worktree`

## UX Model

### Top-Level Behavior

The editor page should include a single visible target selector.

Example labels:

- `Main Checkout - main`
- `Main Checkout - feature/local-experiment`
- `Thread - auth retry flow`
- `Review - JIRA-142 login fix`

When the user changes the active editor target:

- Code-OSS switches to that checkout path
- file explorer updates to that target
- terminal launches use that target path as cwd
- run/debug launches use that target path as workspace root
- git and diff actions operate on that target
- runtime file sync is checked and applied before the target becomes active when files are missing or stale

### Product Rule

The user should never have to manually open a worktree as a separate project just to review thread output.

The editor page is the single place where project checkouts are switched.

## Relationship to Threads

Each execution thread owns a dedicated worktree for implementation.

When a thread reaches `awaiting_review`, Ultra should offer:

- `Open in Editor`
- `Open Diff`
- `Open Terminal`
- `Run Tests`
- `Request Changes`
- `Approve`

`Open in Editor` sets the editor page active target to the thread's worktree.

This should be the default review flow in v1.

## Relationship to Branches

At the git level, the user may care about branches. At the product level, the editor works on checkout targets.

Branch data should be shown prominently, but branch is not the primary selector object.

### Why Branch Is Not the Primary Object

- the editor needs a real path, not an abstract branch
- the same branch cannot generally be checked out in multiple linked worktrees simultaneously
- run/debug and terminal behavior depend on a concrete cwd
- thread ownership is naturally attached to a worktree path

### Supported Branch Flexibility

Ultra should still support:

- viewing any branch currently checked out in any known target
- switching branches inside the active target when the user chooses
- showing branch metadata in the target selector

But the selection model remains target-first, not branch-first.

## Terminal Behavior

All terminals opened from the editor page should inherit the active editor target path as cwd.

Types of terminals Ultra should support:

- general project terminal
- thread terminal
- test terminal
- debug console via Code-OSS/debug adapter integration

### Terminal Rules

- terminal creation in the editor page always uses the active target path
- thread review terminals should be clearly labeled with the target name
- switching the active target does not forcibly move existing terminals
- new terminals always respect the current target

This keeps terminal behavior predictable.

## Run and Debug Behavior

Run and debug should follow the active editor target.

### v1 Rule

When the user starts a run/debug action from the editor page:

- workspace root is the active target path
- process cwd is the active target path
- runtime files are synced before launch when files are missing or stale
- environment variables are injected from the project runtime profile where possible

### User Experience Goal

The user should feel that selecting a target is enough. They should not need to reason about worktree internals when running tests or launching a dev server.

## Runtime File Sync

Many projects depend on file-based local runtime config such as `.env`.

Ultra should support project-level runtime file mirroring into editor targets.

### v1 Default

- project runtime file list defaults to `.env`
- when a target becomes active, Ultra ensures those files exist in that target
- v1 uses managed copy behavior by default

### Managed Copy Behavior

When a target is activated:

- Ultra checks whether configured runtime files exist in the target
- if missing or stale, Ultra copies them from the canonical project source
- Ultra records sync status and timestamp

### User Controls

- `Refresh runtime files`
- `View synced files`
- `Change runtime file list`

This stays simple in v1. Advanced modes such as symlink or generated env materialization are out of scope.

## Runtime Profile

Ultra should maintain a project-scoped runtime profile used by the editor page.

Recommended fields:

- canonical runtime file paths
- environment variables to inject
- last sync timestamp
- per-target sync records

The runtime profile is operational state for local development convenience. It is not a replacement for a full secrets platform.

## Review Flow

Recommended v1 review flow:

1. Thread reaches `awaiting_review`
2. User clicks `Open in Editor`
3. Editor page switches active target to the thread worktree
4. Ultra syncs runtime files such as `.env`
5. User opens terminal, diffs, files, tests, and debug tools in that target
6. User requests changes or approves the work

This keeps thread review inside one environment and avoids manual repo juggling.

## Diff and File Review

The editor page should make review actions target-aware.

Key actions:

- `Open changed files`
- `Open diff vs base branch`
- `Open diff vs main checkout`
- `Open worktree terminal`
- `Run project tests here`

These actions should operate on the active target.

## Known Git Constraints

Ultra should acknowledge and design around the following:

- the same branch cannot normally be checked out simultaneously in multiple linked worktrees
- a thread-owned execution worktree may continue to own its branch during review
- the main checkout should not be assumed to be able to switch directly to that branch while it is active elsewhere

### Product Consequence

Ultra should prefer switching the editor page to the thread worktree instead of trying to remap the main checkout to the thread branch.

Secondary review worktrees are out of scope for v1.

## Minimal UI Elements

The editor page should include:

- target selector
- target metadata row
- runtime sync indicator
- open terminal action
- open diff action
- open changed files action
- run/debug actions

Out of scope for v1:

- saved favorite targets
- quick target search
- target health badges

## Data Model Additions

Recommended new editor-target records:

- `editor_targets`
- `project_runtime_profiles`
- `target_runtime_syncs`

Recommended `editor_targets` fields:

- `target_id`
- `project_id`
- `thread_id`
- `path`
- `target_type`
- `display_name`
- `branch_name`
- `base_branch`
- `is_active`
- `is_main_checkout`
- `created_at`
- `updated_at`

## Out of Scope for v1

- multiple active targets open side-by-side
- automatic branch sharing across linked worktrees
- advanced env resolution strategies
- full workspace merge simulation across multiple checkouts

## Decisions Locked By This Spec

1. The editor page uses a single active editor target model
2. Editor targets are concrete checkout paths, not abstract branches
3. Branch remains visible metadata, not the primary selection object
4. Thread review happens by switching the editor page to the thread target
5. Terminal and run/debug behavior follow the active target path
6. Runtime files default to managed copy of `.env` into the active target
