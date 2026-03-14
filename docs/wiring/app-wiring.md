# Ultra App Wiring

## Scope

This document covers global app-shell flows:

- app startup
- backend connection
- project open
- page navigation
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
- set current page from last persisted state if available

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
- render page state for the project

## Flow: Top Pill Navigation

User action:

- click `Chat`, `Editor`, or `Browser`

Frontend:

- update current page in store

IPC:

- `projects.set_layout`

Backend:

- persist updated page/layout state

DB:

- `project_layout_state`

UI updates:

- route to selected page

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

- restore current page
- restore pane collapse state
- restore active chat, selected thread, and last editor target when available
