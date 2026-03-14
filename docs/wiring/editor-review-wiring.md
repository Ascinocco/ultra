# Ultra Editor Review Wiring

## Scope

This document covers:

- opening a thread in Editor
- active target switching
- runtime file sync
- changed files and diffs
- request changes and approve actions

## Flow: Open Thread In Editor

User action:

- click `Open in Editor` from chat or thread UI

IPC:

- `threads.open_in_editor`

Backend:

- resolve thread worktree target
- set target as active for the project
- trigger runtime sync

DB:

- `threads`
- `editor_targets`
- `target_runtime_syncs`
- `project_layout_state`

Store updates:

- set page to `Editor`
- set active target for project
- keep selected thread

## Flow: Set Active Editor Target

User action:

- change target from the selector

IPC:

- `editor.set_active_target`

Backend:

- persist target choice
- trigger runtime sync if required

DB:

- `editor_targets`
- `project_layout_state`
- `target_runtime_syncs`

Store updates:

- update `activeTargetIdByProject`
- update runtime sync status

## Flow: Sync Runtime Files

Trigger:

- target activation or explicit refresh

IPC:

- `editor.sync_runtime_files`

Backend:

- read runtime profile
- copy configured files such as `.env`
- record sync result

DB:

- `project_runtime_profiles`
- `target_runtime_syncs`

Store updates:

- refresh runtime sync indicator

## Flow: Open Changed Files

User action:

- click `Open Changed Files`

IPC:

- `threads.get_changed_files`
- `editor.open_changed_files`

Backend:

- compute or read thread file-change projection
- return ordered changed-file list

DB:

- `thread_file_changes`

Store updates:

- store current changed-file list for the selected thread

UI updates:

- open changed files in the editor host

## Flow: Open Diff

User action:

- click `Open Diff`

IPC:

- `threads.get_changed_files`
- `editor.open_diff`

Backend:

- resolve file and base/head context from active target

DB:

- `thread_file_changes`

UI updates:

- open diff editors in the editor host

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
