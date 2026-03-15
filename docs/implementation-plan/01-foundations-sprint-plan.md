# Milestone 1 Sprint Plan: Foundations

## Status

Draft v0.1

This document breaks Milestone 1 into an executable sprint plan.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [01-foundations.md](/Users/tony/Projects/ultra/docs/implementation-plan/01-foundations.md)
- [01-foundations-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/01-foundations-architecture.md)
- [local-development.md](/Users/tony/Projects/ultra/docs/local-development.md)

## Sprint Goal

Build a working Ultra shell that can open a project, persist minimal project/layout state, talk to a backend over IPC, and navigate between Chat, Editor, and Browser pages with the correct dark-only app frame.

## Definition of Done

Milestone 1 is done when:

- the app launches reliably
- the backend launches reliably
- IPC handshake works
- SQLite bootstraps and runs migrations
- a project can be opened and persisted
- project layout state can be read and written
- the three top pill pages exist and switch correctly
- the frontend state model is normalized and not centered on an `activeChat` blob

## Sprint Breakdown

### Sprint 1: Workspace and App Skeleton

Goal:

Set up repository structure and a bootable app shell.

Tasks:

- create `apps/desktop`
- create `apps/backend`
- create `packages/shared`
- establish TypeScript workspace configuration
- establish shared linting/formatting baseline
- create desktop entrypoint
- create top-level `AppShell`
- create top pill nav with `Chat`, `Editor`, `Browser`
- create placeholder page shells
- establish dark-only shell tokens

Exit criteria:

- app starts
- page switching works
- dark shell is visible

### Sprint 2: Backend Bootstrap and IPC Handshake

Goal:

Make the backend a real process with a real handshake.

Tasks:

- create Bun backend entrypoint
- create Unix socket bootstrap
- implement `system.hello`
- implement `system.ping`
- create shared IPC envelope types in `packages/shared`
- build frontend IPC client
- connect frontend to backend on app startup
- surface connection state in the UI

Exit criteria:

- frontend connects to backend
- handshake response is visible and usable
- connection state changes are handled cleanly

### Sprint 3: SQLite Bootstrap and Migrations

Goal:

Make persistence real.

Tasks:

- choose DB access layer
- create SQLite bootstrap
- enable WAL and foreign keys
- create migration runner
- implement initial migrations for:
  - `projects`
  - `project_settings`
  - `project_layout_state`
  - `schema_migrations`
- add backend DB module

Exit criteria:

- DB file is created
- migrations run successfully
- app restart reuses existing DB

### Sprint 4: Project Open Flow

Goal:

Make project context real.

Tasks:

- implement path canonicalization
- determine project key from git root or folder path
- implement `projects.open`
- implement `projects.get`
- implement `projects.list`
- store/update project record
- expose open-project flow in frontend
- show active project identity in app frame

Exit criteria:

- user can open a project
- project persists across app restarts
- active project state is reflected in the UI

### Sprint 5: Layout Persistence

Goal:

Persist minimal per-project layout state.

Tasks:

- implement `projects.get_layout`
- implement `projects.set_layout`
- add layout slice to frontend store
- persist current page
- persist right pane collapse defaults
- restore layout on project load

Exit criteria:

- switching pages persists
- layout restores for a project after restart

### Sprint 6: Hardening and Developer Loop

Goal:

Make Foundations usable as a base for Milestone 2.

Tasks:

- add clear UI states for backend unavailable / DB error / project open failure
- clean up startup sequencing
- add basic tests for:
  - handshake
  - project open
  - layout persistence
  - migration runner
- document local dev commands

Exit criteria:

- no silent failure paths in shell startup
- basic test coverage exists for foundational contracts
- local dev loop is documented

## Suggested Work Order

Recommended order:

1. workspace setup
2. desktop app shell
3. backend bootstrap
4. IPC handshake
5. SQLite + migrations
6. project open flow
7. layout persistence
8. tests and startup hardening

Do not start Milestone 2 UI work before steps 3 through 7 are stable.

## Teaming Guidance

If one person is doing the work, the order above is still right.

If work is parallelized later:

- one stream can own desktop shell and frontend store
- one stream can own backend bootstrap, DB, and IPC

But shared DTOs and envelope shapes should be agreed first.

## Deliverables by Layer

### Frontend

- app shell
- page router
- top pill nav
- project frame
- connection state indicator
- project state and layout state slices

### Backend

- Bun server bootstrap
- socket listener
- system service
- project service
- layout service
- DB initialization

### Shared

- IPC envelope types
- project DTOs
- layout DTOs
- common constants

## Acceptance Checks

Use these checks before calling the milestone done:

- can I launch Ultra and see the three top pills?
- can I switch between Chat, Editor, and Browser?
- can the frontend connect to the backend every time?
- can I open a project and see it persist?
- does layout restore correctly after restart?
- are backend/DB failures visible to the user?

## Main Risks During Execution

### 1. Overbuilding

Avoid adding real chat/thread/runtime logic into this sprint plan. It will slow down the foundation.

### 2. Premature Abstraction

Do not build elaborate service/plugin frameworks before the boot flow works.

### 3. Shared-Type Drift

If frontend/backend DTOs drift early, every later milestone pays for it.

## Deferred To Milestone 2

- chat records and transcripts
- plan/spec approvals
- thread creation
- thread event streaming
- thread UI

## Output of This Milestone

At the end of Milestone 1, the repo should feel like a real product skeleton rather than a blank repo with documents.
