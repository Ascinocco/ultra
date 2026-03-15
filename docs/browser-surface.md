# Ultra Browser Surface

## Status

Draft v0.1

This document defines the browser surfaces in Ultra for manual testing and agent-driven QA.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [ui-layout-and-navigation.md](/Users/tony/Projects/ultra/docs/ui-layout-and-navigation.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)

## Purpose

Ultra should be an all-in-one development and QA environment for agentic software engineering.

To support that, Ultra needs:

- a first-class manual browser for the user
- a separate automation browser model for agent QA

These must never be the same browser context.

## Core Rule

Agents never get access to the manual browser session.

The manual browser is user-owned.

Automation browser sessions are isolated, backend-controlled, and thread-scoped.

## Top-Level Navigation

Ultra now has three top-level pill navigation controls:

- `Chat`
- `Editor`
- `Browser`

The Browser page is a peer of Chat and Editor.

## Browser Modes

### 1. Manual Browser

The manual browser is the user-facing browser surface for:

- manual QA
- checking docs and external tools
- testing app flows
- authenticated browsing
- running browser-based workflows during development

This browser should feel persistent and practical for daily use.

It is a convenience feature, not a core programmable agent surface.

### 2. Automation Browser

The automation browser is used by thread-driven QA automation.

It should be:

- isolated from the manual browser
- thread-scoped
- resettable
- safe to inspect after failures

It exists to support automated QA artifacts such as:

- screenshots
- traces
- console errors
- network failures
- test result summaries

## Manual Browser Requirements

The manual browser must support:

- top-level Browser page
- side browser that can open from Chat or Editor
- vertical split mode
- resizable browser panel
- URL bar
- back/forward/reload
- bookmarks
- downloads
- persistent browser session/profile

### Bookmark Scope

For v1, bookmarks should be global-only.

Ultra does not need project-scoped bookmarks in v1.

## Side Browser

The side browser is a utility surface, not a separate top-level mode.

It should be available from:

- Chat page
- Editor page

### Behavior

- opens as a right-side vertical split
- is resizable
- can be collapsed and restored
- does not replace the main page

This is intended for quick visual QA and docs lookup while staying in the current workflow.

## Browser Page

The Browser page is for dedicated manual testing sessions.

### Purpose

- focused testing
- browsing with full session continuity
- reproducing bugs
- validating changes while staying inside Ultra

The Browser page should feel like a serious browser surface, not a toy preview pane.

## Manual Browser Persistence

The manual browser should maintain a persistent user browser profile with:

- cookies
- site data
- history
- bookmarks

This is a product requirement.

## Automation Browser Model

Automation browser sessions are separate from the manual browser.

### Rules

- automation sessions are never backed by the user's manual profile
- automation sessions are scoped to a thread
- automation sessions may be ephemeral or retained for debugging
- automation sessions are started by backend/runtime systems, not by raw UI browser navigation

### Primary Uses

- agent-driven QA
- reproduction of thread-specific UI issues
- browser testing against local dev servers
- artifact generation for thread review

## QA Automation Flow

Recommended thread QA flow:

1. thread work reaches a testable point
2. backend launches an isolated automation browser session
3. QA automation runs against the thread's target app/environment
4. artifacts are captured
5. results are attached to the thread
6. user can inspect failures in Ultra

### Recommended Backend Implementation Direction

Use a backend-controlled browser automation layer, likely Playwright-backed.

The product should not depend on exposing the manual browser to agents.

### Locked v1 Isolation Decision

For v1, the automation browser should be implemented as a backend-owned Playwright service.

Isolation rules:

- each thread QA run gets its own isolated browser context and profile directory
- automation cookies, storage, and credentials never reuse the manual browser partition
- successful runs may clean up after artifact extraction
- failed runs may be retained temporarily for debugging until retention policy prunes them

The manual browser remains the only browser surface backed by the persistent `persist:manual-browser` profile.

## Thread Integration

Threads should be able to expose browser-related actions such as:

- `Open in Browser`
- `Run Browser QA`
- `View Browser QA Artifacts`

These actions should resolve into either:

- manual browser usage
- isolated automation sessions

depending on the action.

## Editor and Chat Integration

From Chat and Editor, Ultra should allow:

- `Open Side Browser`
- `Open Current App in Browser`
- `Open Thread App in Browser`

The Browser page should also be reachable through the top pill navigation.

The browser is mainly for user convenience and manual QA. LLMs and coordinators do not need deep direct interaction with the manual browser.

## Security and Privacy Rules

- manual browser session is user-private
- automation browser sessions are isolated from manual cookies and credentials
- agents never read manual browser session state
- extension and credential handling in the manual browser must be treated as sensitive local state

## Data Model Direction

Browser records:

- `browser_profiles`
- `browser_bookmarks`
- `browser_sessions`
- `thread_browser_runs`
- `browser_artifacts`

## UI Expectations

### Browser Top Nav

The Browser pill should sit alongside Chat and Editor in the top app navigation.

### Browser Chrome

The manual browser should include:

- address bar
- navigation controls
- bookmark control
- profile/session continuity

### Split View

When opened as a side browser:

- the main page remains visible
- the browser uses a vertical split
- the split is resizable

## Technical Risk Areas

The highest-risk areas are:

- profile persistence and security
- clean separation between manual and automation browser contexts

These should be validated with prototypes early, before they are assumed to be low-risk implementation details.

## Locked Decisions

1. Ultra has a third top-level page: Browser
2. Browser uses top-pill navigation alongside Chat and Editor
3. Manual browser and automation browser are separate systems
4. Agents never access the manual browser
5. Side browser split-view exists for Chat and Editor
6. Manual browser uses a persistent user profile
7. The manual browser is implemented with an Electron `WebContentsView` backed by one persistent `persist:manual-browser` session partition
8. The automation browser is implemented separately with Playwright-backed, thread-scoped isolated profiles and artifacts
9. Bookmark persistence is global-only in v1 and stored against the manual browser profile
