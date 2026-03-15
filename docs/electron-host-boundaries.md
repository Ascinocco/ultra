# Ultra Electron Host Boundaries

## Status

Draft v0.1

This document defines the boundaries around the embedded Electron-hosted surfaces in Ultra.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)
- [browser-surface.md](/Users/tony/Projects/ultra/docs/browser-surface.md)
- [artifact-sharing.md](/Users/tony/Projects/ultra/docs/artifact-sharing.md)

## Purpose

Ultra uses Electron-hosted embedded surfaces for two distinct product areas:

- the Code-OSS workbench in the Editor page
- the persistent manual browser in the Browser page and side browser

This doc exists to answer:

`What does each embedded surface own, and what must stay in the Ultra shell/backend instead?`

## Core Rule

Embedded hosts are presentation and tool-integration surfaces.

They are not the product workflow brain.

Workflow state, durable records, and lifecycle policy remain in the Ultra app shell and backend.

## Embedded Surfaces

### 1. Editor Workbench Host

The Editor page embeds a dedicated Code-OSS workbench surface inside a dedicated Electron `WebContentsView`.

This surface exists for:

- file editing
- code navigation
- diffs
- terminals
- run/debug

### 2. Manual Browser Host

The manual browser is hosted in an Electron `WebContentsView` backed by the persistent `persist:manual-browser` session partition.

This surface exists for:

- manual QA
- authenticated browsing
- docs lookup
- persistent browser continuity inside Ultra

## What The Ultra Shell Owns

The Ultra shell and backend own:

- current project and layout state
- active editor target selection
- thread selection and review state
- runtime file sync policy
- publish and approval flows
- artifact capture and share destinations
- manual versus automation browser separation rules

## What The Editor Host Owns

The embedded Code-OSS surface owns:

- rendering the workbench UI
- opening workspaces and files
- rendering diffs
- hosting terminals and debug surfaces

### Rule

The editor host must not decide:

- review state
- thread state transitions
- publish state
- runtime sync policy
- project layout persistence

## What The Manual Browser Host Owns

The manual browser host owns:

- browsing chrome
- navigation state inside the browser surface
- persistent manual session/profile continuity
- downloads and page-level browsing behavior

### Rule

The manual browser host must not become the automation browser.

Agents and backend automation never reuse the manual browser partition.

## Editor Host Adapter Boundary

The Editor page should talk to the embedded workbench through a narrow `EditorHostAdapter`.

Recommended adapter surface:

- `open_workspace(path)`
- `open_file(path)`
- `open_diff(left_path, right_path)`
- `open_changed_files(paths[])`
- `create_terminal(cwd, label)`
- `run_debug(profile_id?)`

### Design Rule

If a workflow concept does not belong to that list, it probably belongs in the Ultra shell/backend instead of the host adapter.

## Manual Browser Host Boundary

The manual browser host should stay intentionally thin.

Responsibilities:

- render the current page
- navigate to URLs
- expose browser state needed by the Browser page and side browser
- preserve the persistent manual profile

It should not own:

- artifact destination logic
- thread-scoped automation sessions
- runtime/debug share logic

## Automation Boundary

Automation browser work is not an Electron host responsibility.

It remains backend-owned and Playwright-backed, using thread-scoped isolated profiles.

### Rule

There is no shared cookie jar, session partition, or credential state between:

- the manual browser host
- automation browser runs

## Security and Data Boundaries

### Manual Browser

Sensitive local state may exist in the manual browser profile:

- cookies
- site data
- credentials
- browsing history

That state is user-private and must not be exposed to agents.

### Editor Workbench

The editor workbench may host user-selected themes, extensions, and keybindings within the workbench boundary.

That customization does not extend to the Ultra shell itself.

## Failure Handling

If an embedded host fails:

- the Ultra shell should remain alive
- the product should show a recoverable error state
- the failure should not corrupt core project, thread, or chat state

### Rule

Host failure is an integration failure, not a reason to lose product records.

## Why This Boundary Exists

Without these boundaries:

- Code-OSS would start absorbing workflow state that belongs to Ultra
- the manual browser could accidentally bleed into automation flows
- implementation decisions would drift toward convenience instead of product correctness

These host boundaries keep Electron embedding useful without letting it take over the architecture.
