# Milestone 5 Architecture: Browser and Artifact Sharing

## Status

Draft v0.1

This document defines the architecture for Milestone 5 of Ultra: Browser and Artifact Sharing.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [05-browser-and-artifact-sharing.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing.md)
- [browser-surface.md](/Users/tony/Projects/ultra/docs/browser-surface.md)
- [artifact-sharing.md](/Users/tony/Projects/ultra/docs/artifact-sharing.md)
- [ui-layout-and-navigation.md](/Users/tony/Projects/ultra/docs/ui-layout-and-navigation.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Milestone 5 extends Ultra from planning, execution, and review into manual QA and structured debugging context capture.

By the end of this milestone, Ultra should support:

- a dedicated Browser page
- a side browser in Chat and Editor
- a persistent manual browser profile
- isolated automation browser sessions for QA
- explicit artifact sharing into chats and threads

## Architectural Goals

Milestone 5 should optimize for:

- strict separation between manual and automation browser contexts
- simple browser/page embedding model
- explicit and user-mediated sharing
- artifact bundles that are useful but not context-flooding

It should not optimize for:

- extension ecosystems
- password-manager integration
- general-purpose browser replacement ambitions

## Core Browser Boundary

This milestone depends on one non-negotiable rule:

- manual browser is user-owned and private
- automation browser is thread-scoped and backend-controlled

Agents never access the manual browser session directly.

## Browser Architecture

Milestone 5 should model two browser systems:

### Manual Browser

Owns:

- Browser page
- side browser
- persistent session/profile
- user navigation and bookmarks

### Automation Browser

Owns:

- thread-scoped automated QA sessions
- screenshots
- traces
- console/network captures
- test artifacts

### Rule

Do not reuse the same session, cookie jar, or profile between these two systems.

## Frontend Architecture

Milestone 5 frontend should add:

- `BrowserPage`
- `SideBrowserHost`
- `BrowserToolbar`
- `BrowserDestinationChip`
- `ArtifactShareMenu`

### Store Expansion

Recommended new slices:

- `browser`
- `artifactShares`

Recommended `browser` state:

- active browser page URL
- side browser open/closed state
- side browser width
- current browser destination context if side-open
- bookmarks list or bookmark summaries

### Side Browser State

Side browser state should be project-scoped.

It should include:

- `isOpen`
- `sourcePage`
- `targetContextType`
- `targetContextId`
- `currentUrl`
- `width`

## Backend Architecture

Milestone 5 backend should add:

- `ManualBrowserService`
- `AutomationBrowserService`
- `ArtifactCaptureService`
- `ArtifactShareService`

### Responsibilities

`ManualBrowserService`:

- create/load persistent browser profile
- manage bookmarks and basic browser state

`AutomationBrowserService`:

- launch isolated thread-scoped browser sessions
- collect QA artifacts

`ArtifactCaptureService`:

- normalize browser and runtime captures into shareable bundles

`ArtifactShareService`:

- attach captured bundles to chat or thread destinations

## Artifact Sharing Architecture

Artifact sharing should be modeled as:

1. capture
2. normalize
3. destination selection
4. attach to context

### Capture Sources

- manual browser
- active run/debug terminal output
- debug console output
- test/build output
- automation browser artifacts

### Destination Types

- `chat`
- `thread`

### Rule

The destination determines the receiving model/runtime.

## Share Bundle Architecture

Milestone 5 should normalize artifacts into bounded bundles.

### Bundle Types

- `browser_page_bundle`
- `browser_console_bundle`
- `browser_network_bundle`
- `runtime_output_bundle`
- `combined_debug_bundle`

### Combined Bundle

The `Share All Context` path should create a combined bundle containing:

- browser context
- browser console logs
- browser network data
- active terminal/debug output

### Design Rule

Do not attach raw unlimited logs directly into chat context.

Every bundle should support:

- metadata
- summary
- structured payload
- optional file-backed large content

## Browser Page Architecture

The Browser page is a top-level mode.

### Responsibilities

- dedicated manual browsing
- focused QA/manual testing
- explicit share-to destination selection

### Rule

When on the Browser page, there is no implicit share destination.

Use an explicit destination picker.

## Side Browser Architecture

The side browser is a contextual tool for Chat and Editor.

### Responsibilities

- contextual browsing without leaving the current page
- default-share targeting to the current visible context

### Rule

When opened from:

- Chat: default destination is the active chat
- Thread detail: default destination is the selected thread
- Editor review flow: default destination is the active thread if one is in review context

Always show the destination visibly before sending.

## Automation Browser Architecture

Milestone 5 should treat automation browser runs as backend-owned QA jobs.

### Flow

1. thread requests browser QA
2. backend launches isolated browser automation session
3. QA run executes
4. artifacts are collected
5. artifacts are attached to thread

### Rule

Automation browser results should integrate with thread artifacts and timeline, not with the manual browser UI state.

## IPC Architecture For Milestone 5

Implement these IPC areas for real:

- `artifacts.list_by_thread`
- `artifacts.get`
- `editor.open_in_target` if needed for browser-linked file jumps later

Add new browser/artifact methods such as:

- `browser.get_state`
- `browser.set_side_open`
- `browser.navigate`
- `browser.list_bookmarks`
- `browser.create_bookmark`
- `artifacts.capture_browser`
- `artifacts.capture_runtime`
- `artifacts.share_to_chat`
- `artifacts.share_to_thread`
- `artifacts.share_all_context`

The exact namespace can remain flexible, but the operation classes should exist.

## Persistence Architecture

Milestone 5 may implement a focused first subset:

- bookmark persistence
- artifact metadata persistence
- artifact-share records if needed

The existing `artifacts` table can be extended or used as the base.

If needed, add later:

- `artifact_shares`
- `browser_bookmarks`

## Error Handling Expectations

Milestone 5 should visibly handle:

- browser embedding failure
- capture failure
- missing share destination
- oversized artifact bundle
- automation browser failure

## Testing Strategy

Recommended test areas:

- manual browser/session persistence basics
- side browser open/close/resize state
- destination targeting rules
- `Share All` bundle generation
- artifact attachment to chat/thread
- isolation between manual and automation sessions

## Main Architectural Risks

### 1. Privacy Boundary Erosion

If manual and automation browser contexts mix, the product trust model breaks.

### 2. Bundle Flooding

If artifacts are too large or too raw, chats and threads become noisy and expensive.

### 3. Browser Embedding Complexity

If embedding choices are unstable, this milestone can expand unexpectedly.

## Locked Decisions For This Milestone

1. Browser is a first-class top-level page
2. Side browser exists in Chat and Editor
3. Manual and automation browser systems are separate
4. Artifact sharing is explicit and user-mediated
5. `Share All` and combined context share are first-class

## Open Follow-Ups

1. exact browser embedding primitive
2. exact artifact bundle storage thresholds
3. whether bookmarks need project scope or only global scope
