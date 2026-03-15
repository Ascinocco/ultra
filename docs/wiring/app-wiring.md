# Ultra App Wiring

## Scope

This document covers global app-shell flows:

- app startup
- backend connection
- project open
- active project and chat restoration
- sandbox selection
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

Store updates:

- set backend connection state
- hydrate project list
- restore last active project if available
- restore project-scoped shell state from persisted layout if available

## Flow: Open Project

User action:

- open or select a project path

Frontend:

- dispatch open-project action

IPC:

- `projects.open`
- `projects.get_layout`
- `chats.list`

Backend:

- canonicalize path
- determine project key
- create or update `projects` row
- read or create `project_layout_state`
- return project-scoped chat context

Store updates:

- append or update project summary
- set `activeProjectId`
- hydrate project layout
- hydrate or refresh chat list

UI updates:

- show the project in the left sidebar
- render the project's chats in the sidebar
- restore the active chat if available

## Flow: Switch Project

User action:

- select another project from the left sidebar

IPC:

- `projects.get`
- `projects.get_layout`
- `chats.list`
- `threads.list`

Store updates:

- set `activeProjectId`
- hydrate project-specific chat, thread, and layout state

UI updates:

- swap sidebar chats to the selected project
- update the center chat pane
- update the right thread pane
- preserve project-scoped terminal drawer state

## Flow: Top Bar Sandbox And Terminal Controls

User action:

- choose a sandbox or click `Open Terminal`

Frontend:

- update active sandbox or terminal drawer state in store

IPC:

- `sandboxes.set_active`
- `projects.set_layout`

Backend:

- persist updated sandbox and layout state

UI updates:

- reflect the selected sandbox
- open or focus the terminal drawer when requested

## Flow: Restore Layout

Trigger:

- app restart or project reopen

IPC:

- `projects.get_layout`

Backend:

- return persisted layout state

Store updates:

- restore selected thread
- restore active chat
- restore active sandbox
- restore terminal drawer state when available

### Layout Rule

The shell no longer restores obsolete editor or browser page state in the v1 direction.
