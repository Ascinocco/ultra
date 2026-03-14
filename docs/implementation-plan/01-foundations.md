# Milestone 1: Foundations

## Goal

Establish the application skeleton, backend skeleton, IPC baseline, SQLite baseline, and normalized frontend state model so the rest of the product can be built on stable plumbing.

## Why First

Without this milestone, every later feature would be built on unstable assumptions about:

- app shell structure
- page routing
- local backend process model
- persistence
- event delivery
- frontend state ownership

## Scope

- top-level app shell
- top pill navigation: `Chat`, `Editor`, `Browser`
- dark-only app shell baseline
- backend bootstrap process
- Unix socket IPC handshake
- SQLite bootstrap and migration runner
- normalized frontend store
- project open/load flow
- per-project layout persistence shell

## Deliverables

- desktop app shell that launches successfully
- page routing between Chat, Editor, and Browser
- backend process started and reachable
- `system.hello` IPC handshake
- empty project load path
- database file creation and migration application
- Zustand store shape aligned with current specs
- persisted layout state for active page and pane collapse shell

## Out of Scope

- real chat model execution
- real thread execution
- real editor target switching
- browser embedding
- runtime supervision beyond process bootstrap

## Technical Decisions To Respect

- IPC remains internal-only
- Unix domain socket plus JSON envelopes
- snapshots plus subscriptions model
- SQLite is source of truth for Ultra-local state
- app shell is dark-only

## Exit Criteria

- app can open a project and render all three top-level pages
- frontend can talk to backend over the agreed handshake
- SQLite bootstraps reliably
- layout state persists per project
- store model supports multiple chats and threads without nested state hacks

## Main Risks

- backend lifecycle and process ownership
- prematurely coupling UI to incomplete backend contracts
- building the wrong store shape and paying for it later
