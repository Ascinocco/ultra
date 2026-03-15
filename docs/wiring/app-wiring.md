# Ultra App Wiring

## Scope

This document covers global app-shell flows:

- app startup
- backend connection
- project open
- worktree selection
- terminal drawer visibility
- layout persistence

## Flow: App Startup

User action:

- launch Ultra

Frontend:

- boot `AppShell`
- initialize Zustand store
- show connection state as `connecting`

IPC:

- connect to local socket
- send `system.hello`
- optionally send `system.get_backend_info`

Backend:

- start socket server
- open SQLite
- run migrations
- respond with protocol and capability info

DB:

- `schema_migrations`
- `projects`
- `project_layout_state`

Store updates:

- set backend connection state
- set project-scoped shell state from last persisted layout if available

## Flow: Open Project

User action:

- open/select a project path

Frontend:

- dispatch open-project action

IPC:

- `projects.open`
- `projects.get_layout`

Backend:

- canonicalize path
- determine project key
- create/update `projects` row
- read/create `project_layout_state`

DB:

- `projects`
- `project_layout_state`

Store updates:

- set `activeProjectId`
- hydrate project summary
- hydrate project layout

UI updates:

- show project identity in app frame
- render project-scoped shell state for the project

## Flow: Top Bar Worktree And Terminal Controls

User action:

- choose a worktree or click `Open Terminal`

Frontend:

- update active worktree or terminal drawer state in store

IPC:

- `worktrees.set_active`
- `projects.set_layout`

Backend:

- persist updated worktree and layout state

DB:

- `project_layout_state`

UI updates:

- reflect the selected worktree
- open or focus the terminal drawer when requested

## Flow: Restore Layout

Trigger:

- app restart or project reopen

IPC:

- `projects.get_layout`

Backend:

- return persisted layout state

DB:

- `project_layout_state`

Store updates:

- restore pane collapse state
- restore active chat, selected thread, last active worktree, and terminal drawer state when available
