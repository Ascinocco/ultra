# Ultra Worktree Terminal Wiring

## Scope

This document covers:

- selecting an active worktree
- runtime file sync
- opening the integrated terminal
- running saved commands
- request changes and approve actions
- external handoff from the active worktree

## Flow: Select Active Worktree

User action:

- choose a worktree from the top bar or thread UI

IPC:

- `worktrees.set_active`
- `worktrees.get_active`

Backend:

- resolve the selected worktree
- persist active worktree for the project
- trigger runtime sync status refresh if required

DB:

- `threads`
- worktree context records
- `project_layout_state`
- runtime sync records

Store updates:

- set active worktree for project
- update runtime sync status

## Flow: Sync Runtime Files

Trigger:

- worktree activation or explicit refresh

IPC:

- `terminal.sync_runtime_files`

Backend:

- read runtime profile
- copy configured files such as `.env`
- record sync result

DB:

- runtime profile tables
- runtime sync records

Store updates:

- refresh runtime sync indicator

## Flow: Open Terminal

User action:

- click `Open Terminal` from the top bar or thread UI

IPC:

- `terminal.open`

Backend:

- resolve active worktree
- ensure runtime sync is current enough for launch
- create or focus a terminal session for that worktree

DB:

- terminal session records if persisted
- `project_layout_state`

Store updates:

- mark terminal drawer open
- add or focus terminal session

## Flow: Run Saved Command

User action:

- click `test`, `dev`, `lint`, or another saved command

IPC:

- `terminal.run_saved_command`

Backend:

- resolve active worktree
- ensure runtime sync is current enough for launch
- start the saved command in the correct cwd

DB:

- terminal session records if persisted
- saved command history if tracked

Store updates:

- append or focus terminal session
- update session metadata

## Flow: Request Changes

User action:

- click `Request Changes`

IPC:

- `threads.request_changes`

Backend:

- validate current thread state
- append review and execution events
- update thread snapshot back toward active execution

DB:

- `thread_events`
- `threads`

Store updates:

- patch thread snapshot
- append thread events

## Flow: Approve Thread

User action:

- click `Approve`

IPC:

- `threads.approve`

Backend:

- validate thread is reviewable
- append approval/completion events
- update thread snapshot to approved/completed

DB:

- `thread_events`
- `threads`

Store updates:

- patch thread snapshot
- append thread events

## Flow: External Handoff

User action:

- click `Open in Editor`, `Open in GitHub`, or `Open in Browser`

IPC:

- `handoff.open_editor`
- `handoff.open_github`
- `handoff.open_browser`

Backend:

- resolve active worktree and related branch/thread context
- construct handoff target
- invoke the external tool

DB:

- none required by default beyond reading current project/worktree/thread state

Store updates:

- optional handoff history update
