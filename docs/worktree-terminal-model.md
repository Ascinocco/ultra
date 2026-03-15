# Ultra Worktree Terminal Model

## Status

Draft v0.1

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [ui-layout-and-navigation.md](/Users/tony/Projects/ultra/docs/ui-layout-and-navigation.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)

This document defines how Ultra should handle worktree selection, terminal sessions, runtime file sync, and external handoff during the testing and approval loop.

## Purpose

Ultra's core testing loop is not "open a full editor." It is:

1. select the right project or thread worktree
2. make sure the right runtime files are present
3. open or reuse a terminal already pointed at that context
4. run tests and dev commands
5. decide whether to approve or request changes

The product should make that loop fast and obvious from the main chat workspace.

## Core Principle

Ultra always has one active worktree context per project.

An active worktree context is a concrete filesystem path paired with the metadata needed to operate safely inside it:

- project
- optional thread
- branch
- target kind
- runtime sync status

The terminal, saved commands, and approval loop all follow this active worktree context.

## Worktree Context

### Definition

A worktree context is a concrete checkout of a project that Ultra can target for testing and review.

In v1, a worktree context may be:

- the main project checkout
- a thread-owned worktree

Review-specific duplicate worktrees and multi-target editor layouts are out of scope.

### Required Fields

- `worktree_id`
- `project_id`
- `thread_id`
- `path`
- `display_name`
- `target_type`
- `branch_name`
- `base_branch`
- `is_main_checkout`
- `runtime_sync_status`
- `last_used_at`

## Selection Model

The user should be able to switch the active worktree from the shell without opening a second page.

Primary selectors should appear in:

- the top bar
- thread-level actions when a thread has a dedicated worktree
- the terminal drawer header

### Product Rule

Users should not need to manually recreate a worktree as a separate project just to test changes.

Ultra owns the "which checkout am I operating in?" decision through a clear worktree selector.

## Terminal Model

The integrated terminal is part of the main chat workspace, not a separate editor surface.

### Required Behaviors

- `Open Terminal` is available from the top bar
- the chat page includes a terminal drawer or pane
- new terminals start with `cwd = active worktree path`
- terminals are clearly labeled by worktree and thread when applicable
- switching the active worktree does not forcibly move existing terminals
- opening a terminal from a thread should prefer that thread's worktree

### Product Goal

The user should be able to move from "agent made changes" to "I am testing those changes locally" in one or two actions.

## Runtime File Sync

Many projects require file-based runtime configuration such as `.env`.

Ultra should support project-level runtime file sync into the active worktree context.

### v1 Default

- runtime file list defaults to `.env`
- sync mode defaults to managed copy
- target activation or terminal launch can trigger sync when needed
- sync status is visible before the user runs commands

### User Controls

- `Refresh runtime files`
- `View synced files`
- `See last sync result`

## Saved Commands

The worktree workflow should expose a small set of repeatable commands for the active context.

Examples:

- `test`
- `dev`
- `lint`
- `build`

These commands should always run against the active worktree path and inherit the synced runtime files for that worktree.

## Review and Approval Flow

Recommended v1 flow:

1. thread reaches a reviewable state
2. user selects the thread's worktree
3. Ultra syncs runtime files such as `.env`
4. user opens or reuses a terminal in that worktree
5. user runs tests or local verification commands
6. user requests changes or approves from thread-aware UI in the chat workspace

This keeps the review loop centered on worktree selection, terminal readiness, and thread state transitions rather than an embedded editor.

## External Handoff

Ultra does not need to own every review surface in v1.

External handoff remains acceptable for:

- full diff review in GitHub
- opening files in a user-chosen editor
- browser-based manual QA

The core in-product responsibility is to make the local testing loop fast and worktree-aware.

## Non-Goals

- embedded Code-OSS as a v1 requirement
- embedded browser as a v1 requirement
- custom diff review UI
- branch-as-primary navigation
