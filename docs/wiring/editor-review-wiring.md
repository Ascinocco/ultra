# Ultra Sandbox Terminal Wiring

## Scope

This document covers:

- selecting an active sandbox
- runtime file sync
- opening the integrated terminal
- running saved commands
- request changes and approve actions
- external handoff from the active sandbox

## Flow: Select Active Sandbox

User action:

- choose a sandbox from the top bar or thread UI

IPC:

- `sandboxes.set_active`
- `sandboxes.get_active`

Backend:

- resolve the selected sandbox
- persist active sandbox for the project
- trigger runtime sync status refresh if required

Store updates:

- set active sandbox for project
- update runtime sync status

## Flow: Sync Runtime Files

Trigger:

- sandbox activation or explicit refresh

IPC:

- `terminal.sync_runtime_files`

Backend:

- read runtime profile
- copy configured files such as `.env`
- record sync result

Store updates:

- refresh runtime sync indicator

## Flow: Open Terminal

User action:

- click `Open Terminal` from the top bar or thread UI

IPC:

- `terminal.open`

Backend:

- resolve active sandbox
- ensure runtime sync is current enough for launch
- create or focus a terminal session for that sandbox

Store updates:

- mark terminal drawer open
- add or focus terminal session

## Flow: Run Saved Command

User action:

- click `test`, `dev`, `lint`, or another saved command

IPC:

- `terminal.run_saved_command`

Backend:

- resolve active sandbox
- ensure runtime sync is current enough for launch
- start the saved command in the correct cwd

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
- append approval and completion events
- update thread snapshot to approved or completed

Store updates:

- patch thread snapshot
- append thread events

## Flow: External Handoff

User action:

- click `Open in Editor`, `Open in GitHub`, or `Open in Browser`

IPC:

- `handoff.open_in_editor`
- `handoff.open_in_github`
- `handoff.open_in_browser`

Backend:

- resolve active sandbox and related branch/thread context
- construct handoff target
- invoke the external tool

Store updates:

- optional handoff history update
