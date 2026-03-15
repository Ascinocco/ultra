# Ultra Electron Host Boundaries

## Status

Draft v0.2

This document defines the Electron boundary lines around Ultra's shell-owned surfaces, integrated terminal workflow, and external tool handoff.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [worktree-terminal-model.md](/Users/tony/Projects/ultra/docs/worktree-terminal-model.md)
- [artifact-sharing.md](/Users/tony/Projects/ultra/docs/artifact-sharing.md)

## Purpose

Ultra no longer treats embedded editor and browser hosts as the center of the v1 product.

This doc exists to answer:

`What should Electron own directly, what should stay in the Ultra shell/backend, and what should be handed off to external tools?`

## Core Rule

Electron-hosted surfaces are shell integration boundaries.

They are not the workflow brain.

Workflow state, durable records, and lifecycle policy remain in the Ultra app shell and backend.

## Primary Shell-Owned Surfaces

### 1. Chat Workspace Shell

The BrowserWindow-rendered shell owns:

- project selection
- chat selection
- thread selection
- sandbox selection
- runtime health presentation
- terminal drawer visibility
- review actions

### 2. Integrated Terminal Surface

Ultra may embed or host a terminal surface inside the chat workspace, but that surface exists only to present and interact with terminal sessions that the backend and context model already own.

This surface exists for:

- terminal session display
- command input
- saved command launch
- output visibility during testing and review

### 3. External Handoff

Electron also owns the OS-level handoff path for:

- opening the active sandbox in an external editor
- opening the relevant branch or PR in GitHub
- opening a target URL in the system browser

## What The Ultra Shell Owns

The Ultra shell and backend own:

- current project, chat, and layout state
- active sandbox selection
- thread selection and review state
- runtime file sync policy
- terminal session lifecycle policy
- saved command definitions
- publish and approval flows
- artifact capture and share destinations
- coordinator and Overstory execution projection

## What The Terminal Surface Owns

The integrated terminal surface owns:

- rendering terminal sessions
- accepting user terminal input
- presenting output and session labels

### Rule

The terminal surface must not decide:

- active sandbox identity
- runtime sync policy
- review state
- thread state transitions
- publish state

Those remain backend and shell concerns.

## What External Handoff Owns

External tools own their own local UI and behavior once Ultra opens them.

Examples:

- editor file navigation and editing
- GitHub diff review
- browser navigation and QA outside Ultra

### Rule

Handoff should preserve context, not absorb workflow state back into the external tool.

Ultra opens the right sandbox, branch, PR, or URL. It does not let external tools become the durable source of project workflow state.

## Terminal Adapter Boundary

The chat workspace should talk to terminal integration through a narrow terminal adapter boundary.

Recommended surface:

- `open_session(cwd, label)`
- `focus_session(session_id)`
- `run_saved_command(command_id, cwd)`
- `list_sessions()`
- `close_session(session_id)`

### Design Rule

If a workflow concept does not belong to that list, it probably belongs in the Ultra shell/backend instead of the terminal adapter.

## Deferred Embedded Surfaces

Embedded editor and browser experiments may still exist as reference work, but they are deferred behind the core chat, thread, and terminal loop.

### Rule

Do not make embedded Code-OSS or an embedded manual browser a prerequisite for the near-term roadmap.

## Why This Boundary Exists

Without these boundaries:

- an embedded editor could start absorbing workflow state that belongs to Ultra
- browser work could expand into a parallel product instead of a handoff utility
- terminal integration could become an opaque side effect rather than a sandbox-aware workflow tool

These boundaries keep Electron integration useful without letting it take over the product architecture.
