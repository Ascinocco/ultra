# Milestone 5 Architecture: External QA and Artifact Handoff

## Status

Draft v0.1

This document defines the architecture for Milestone 5 of Ultra: External QA and Artifact Handoff.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [05-browser-and-artifact-sharing.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing.md)
- [artifact-sharing.md](/Users/tony/Projects/ultra/docs/artifact-sharing.md)
- [ui-layout-and-navigation.md](/Users/tony/Projects/ultra/docs/ui-layout-and-navigation.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Milestone 5 extends Ultra from planning, execution, testing, and approval into external QA and structured debugging context capture.

By the end of this milestone, Ultra should support:

- opening the right browser, editor, or GitHub surface from the active worktree context
- capturing runtime and terminal artifacts
- explicitly sharing those artifacts into chats and threads

## Architectural Goals

Milestone 5 should optimize for:

- low-friction handoff from Ultra to external tools
- explicit and user-mediated sharing
- artifact bundles that are useful but not context-flooding
- preserving the chat-plus-terminal workflow as the center of gravity

It should not optimize for:

- replacing the user's editor
- replacing the user's browser
- heavyweight embedded side surfaces unless later evidence proves they are necessary

## Core Handoff Boundary

This milestone depends on one non-negotiable rule:

- Ultra owns workflow state
- external tools own their own editing, browsing, and diff surfaces

Handoff should preserve context, not absorb those tools into the Ultra shell.

## Handoff Architecture

Milestone 5 should model three handoff targets:

### External Editor

Owns:

- file inspection
- file editing
- project-wide navigation

### GitHub or Git Hosting Surface

Owns:

- full diff review
- PR inspection
- branch/publish context when external review is preferred

### System Browser

Owns:

- manual QA
- docs lookup
- app validation outside the core Ultra shell

### Rule

All handoff actions should derive from the active project/worktree/thread context before launching the external target.

## Frontend Architecture

Milestone 5 frontend should add:

- `ExternalHandoffMenu`
- `ArtifactShareMenu`
- `ShareDestinationPicker`

### Store Expansion

Recommended new slices:

- `artifactShares`
- `handoffHistory`

The store should not grow a heavyweight embedded browser/editor state model in this milestone.

## Backend Architecture

Milestone 5 backend should add:

- `ExternalHandoffService`
- `ArtifactCaptureService`
- `ArtifactShareService`

### Responsibilities

`ExternalHandoffService`:

- resolve the active worktree and related branch/thread context
- construct editor/browser/GitHub launch targets
- invoke OS-level open behavior or configured integrations

`ArtifactCaptureService`:

- normalize terminal and runtime captures into shareable bundles

`ArtifactShareService`:

- attach captured bundles to chat or thread destinations

## Artifact Sharing Architecture

Artifact sharing should be modeled as:

1. capture
2. normalize
3. destination selection
4. attach to context

### Capture Sources

- terminal sessions
- run/debug output
- runtime health or failure context
- optional future browser or QA artifacts

### Destination Types

- `chat`
- `thread`

### Rule

The destination determines the receiving model/runtime.

## Share Bundle Architecture

Milestone 5 should normalize artifacts into bounded bundles.

### Bundle Types

- `runtime_output_bundle`
- `terminal_output_bundle`
- `combined_debug_bundle`

### Combined Bundle

The `Share All Context` path should create a combined bundle containing:

- relevant terminal output
- runtime health context
- selected thread metadata
- any related worktree status needed for debugging

### Design Rule

Do not attach raw unlimited logs directly into chat context.

Every bundle should support:

- metadata
- summary
- structured payload
- optional file-backed large content

## Optional Browser Helpers

If later work still justifies browser helpers, they should remain downstream of the handoff model.

### Rule

Do not introduce an embedded browser as a milestone prerequisite.

## IPC Architecture For Milestone 5

Implement these IPC areas for real:

- `handoff.open_editor`
- `handoff.open_browser`
- `handoff.open_github`
- `artifacts.capture_runtime`
- `artifacts.share_to_chat`
- `artifacts.share_to_thread`
- `artifacts.share_all_context`
