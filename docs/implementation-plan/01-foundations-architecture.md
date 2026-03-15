# Milestone 1 Architecture: Foundations

## Status

Draft v0.1

This document defines the architecture for Milestone 1 of Ultra: Foundations.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [01-foundations.md](/Users/tony/Projects/ultra/docs/implementation-plan/01-foundations.md)
- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)
- [ui-layout-and-navigation.md](/Users/tony/Projects/ultra/docs/ui-layout-and-navigation.md)
- [environment-readiness.md](/Users/tony/Projects/ultra/docs/environment-readiness.md)
- [local-development.md](/Users/tony/Projects/ultra/docs/local-development.md)

## Purpose

Milestone 1 is not about feature richness. It is about establishing the architectural base that later milestones can rely on without major rewrites.

This milestone should produce:

- the shell of the app
- the shell of the backend
- the shell of persistence
- the shell of frontend state
- the shell of IPC

If those shells are wrong, every later milestone becomes more expensive.

## Architectural Goals

Milestone 1 should optimize for:

- clear ownership boundaries
- simple boot flow
- stable internal contracts
- minimal but real persistence
- low-risk page and layout scaffolding

It should not optimize for:

- perfect final packaging
- deep runtime behavior
- feature completeness

## System Slice

Milestone 1 includes the minimum viable shape of three major subsystems:

1. app shell
2. backend shell
3. persistence shell

### App Shell

The app shell owns:

- top-level window
- top pill navigation
- page routing
- project frame
- layout persistence hooks
- frontend store bootstrap
- backend connection bootstrap

### Backend Shell

The backend shell owns:

- process startup
- socket creation
- handshake endpoint
- SQLite connection
- migration runner
- basic project open service

### Persistence Shell

The persistence shell owns:

- DB initialization
- migration application
- base repositories or query services for projects and layout state

## Recommended Runtime Topology For Milestone 1

Start with the same high-level process model intended for the long-term product, but implement only the parts needed now.

### Processes

- desktop app process
- backend process

Do not add coordinator, `ov watch`, watchdog, browser automation, or advanced child-process supervision in this milestone beyond placeholders.

### Reason

Milestone 1 should validate app/backend boundaries first. Adding execution runtime complexity too early will blur the architecture.

## Frontend Architecture

### Framework Direction

Use React plus Zustand in the frontend.

### State Model

Use a normalized store, aligned with the backend IPC model.

Recommended initial slices:

- `app`
- `projects`
- `layout`
- `connection`

Later milestones will add:

- `chats`
- `threads`
- `runtime`
- `editor`
- `browser`

### Initial Store Shape

Recommended initial root shape:

```ts
type AppState = {
  app: {
    currentPage: "chat" | "editor" | "browser";
    activeProjectId: string | null;
    connectionStatus: "connecting" | "connected" | "degraded" | "disconnected";
  };
  projects: {
    byId: Record<string, ProjectSnapshot>;
    allIds: string[];
  };
  layout: {
    byProjectId: Record<string, ProjectLayoutState>;
  };
};
```

This should stay minimal in Milestone 1.

### UI Hierarchy

Recommended component hierarchy:

- `AppShell`
- `TopPillNav`
- `ProjectFrame`
- `PageRouter`
- `ChatPageShell`
- `EditorPageShell`
- `BrowserPageShell`

The shells should render real pages, but mostly with placeholders and state wiring in Milestone 1.

## Backend Architecture

### Framework Direction

Use Bun + TypeScript for the backend.

### Initial Backend Modules

Recommended initial modules:

- `server`
- `ipc`
- `db`
- `migrations`
- `projects`
- `layout`
- `system`

This is enough to support:

- socket startup
- handshake
- DB init
- project open/load
- layout get/set

### Service Boundaries

Keep the service layer narrow:

- `SystemService`
- `ProjectService`
- `LayoutService`

Do not introduce runtime, chat, thread, or browser services in Milestone 1 beyond stubs.

## IPC Architecture For Milestone 1

Implement only the minimum subset of the IPC spec:

- `system.hello`
- `system.ping`
- `projects.open`
- `projects.get`
- `projects.list`
- `projects.get_layout`
- `projects.set_layout`

### Message Handling

Use one request router that dispatches on:

- envelope type
- method name

Support:

- command
- query

Subscription support can be stubbed structurally if useful, but real event streams do not need to be completed in Milestone 1.

## Persistence Architecture

### Database Boot

At app startup or backend startup:

1. create/open SQLite database
2. enable foreign keys
3. run schema migrations
4. expose repository/service layer

### Initial Tables To Implement For Real

Milestone 1 should implement a narrow schema subset:

- `projects`
- `project_settings`
- `project_layout_state`
- `schema_migrations`

Optional but useful stubs:

- `chats`
- `threads`

### Why Narrow First

This reduces migration churn while the app shell and IPC are still settling.

## Project Open Flow

Milestone 1 should implement a clean project-open path because everything later depends on it.

### Flow

1. user chooses or opens a project path
2. frontend calls `projects.open`
3. backend canonicalizes the path
4. backend determines project key
5. backend creates or updates project record
6. backend loads project layout state
7. frontend updates active project and page shell state

### Result

The app should feel like it has entered a real project context even before chats and threads exist.

## Layout Persistence

Milestone 1 should persist only the minimal layout state needed now.

Recommended fields:

- current page
- last active project
- right-top collapsed default
- right-bottom collapsed default

More layout details can be added in later milestones as the real panes exist.

## Navigation Architecture

Top-level navigation should already use the final product mental model:

- `Chat`
- `Editor`
- `Browser`

### Rule

This is page-mode navigation, not tab management.

Even with placeholder pages, the user should feel the final product shape immediately.

## Styling Architecture

Milestone 1 should establish the app-shell visual system.

### Requirements

- dark-only app shell
- no light theme code path
- no app-level theme switching
- foundational design tokens for shell colors, spacing, and surfaces

### Important Boundary

Editor theming flexibility belongs later inside the embedded editor environment, not in the shell token system.

## Repo Structure Recommendation

Start with a mono-repo style structure even if it is one repository.

Recommended initial directories:

- `apps/desktop`
- `apps/backend`
- `packages/shared`
- `docs`

### `apps/desktop`

Owns:

- React app shell
- page routing
- Zustand store
- IPC client

### `apps/backend`

Owns:

- Bun entrypoint
- IPC server
- DB setup
- migrations
- services

### `packages/shared`

Owns:

- shared TypeScript types
- IPC envelope types
- project/layout DTOs
- constants

### Why Shared Types Early

Because frontend/backend drift on DTOs and message envelopes becomes expensive very quickly.

## Build and Dev Loop Recommendation

Milestone 1 should support a simple local development loop:

- run frontend shell
- run backend
- connect over local socket
- hot reload frontend where possible
- restart backend manually or automatically in dev

Do not optimize packaging yet.

## Error Handling Expectations

Milestone 1 should visibly handle:

- backend not started
- handshake failure
- database migration failure
- project open failure

The frontend should surface these clearly rather than failing silently.

## Testing Strategy For Milestone 1

Focus on architecture correctness, not exhaustive UI polish.

Recommended initial test areas:

- project path canonicalization
- DB migration runner
- IPC handshake
- project open flow
- layout persistence round-trip

## Main Architectural Risks

### 1. Wrong Frontend State Shape

If Milestone 1 centers state around one nested active payload, later chat/thread work will get ugly fast.

### 2. Weak Backend Boundaries

If DB access, IPC routing, and service logic are mixed together, later runtime complexity will become brittle.

### 3. Premature Feature Coupling

If Milestone 1 tries to partially implement chats, runtime, and browser logic all at once, the architectural base will get muddy.

## Locked Decisions For This Milestone

1. Start with app shell plus backend shell, not extension-first shortcuts
2. Use React plus Zustand in the frontend
3. Use Bun plus TypeScript in the backend
4. Use shared DTO/types package from the beginning
5. Keep DB schema narrow in Milestone 1
6. Implement final-feeling page navigation early, even with placeholder pages
7. `apps/desktop` uses Electron plus React plus TypeScript
8. The desktop shell reserves a dedicated workbench surface for embedded Code-OSS later rather than designing around an extension-only shell
9. SQLite migrations are applied through an explicit backend migration runner owned by the app
10. `packages/shared` owns both shared DTO types and validation schemas
