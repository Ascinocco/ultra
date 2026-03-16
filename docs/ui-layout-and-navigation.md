# Ultra UI Layout and Navigation

## Status

Draft v0.2

This document defines the top-level information architecture, page layout, navigation model, and major UI regions for Ultra.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [worktree-terminal-model.md](/Users/tony/Projects/ultra/docs/worktree-terminal-model.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Ultra needs a UI structure that makes the product feel like a command center instead of an editor with a side chat.

The layout should make these truths obvious:

- projects and chats are the primary planning surface
- threads are the primary execution surface
- testing and debugging happens through a sandbox-aware terminal drawer
- runtime status should be available via the Settings page without cluttering the core workspace

## Top-Level Navigation

Ultra v1 should center the product on a single primary workspace:

- `Chat`

Supporting destinations can remain lightweight:

- `Settings` (accessible from sidebar footer button; includes runtime status)
- `System & Tools`
- external handoff actions such as `Open in Editor`, `Open in GitHub`, or `Open in Browser`

### Product Rule

The user should be able to stay in `Chat` for planning, execution supervision, sandbox selection, testing, and approval. Opening a terminal should feel like extending the chat workspace, not leaving it.

## Global Frame

At the top level, Ultra should maintain a consistent app frame with:

- current project identity
- active sandbox selector
- quick terminal action
- sidebar toggle (collapse/expand)
- settings entry (sidebar footer)

## App Theme Policy

The Ultra application shell should be dark-only.

### Rules

- no light theme
- no app-level theme toggle
- no multiple app shell themes
- no user-defined app shell themes

### External Tool Boundary

External tools may visually diverge because they keep their own themes and keybindings.

This is acceptable because Ultra no longer treats those tools as first-class embedded pages in v1.

## Top Bar

The top bar should feel closer to a command header than a page switcher.

For v1, it should include:

- sidebar toggle button (left, after traffic lights)
- current project identity
- active sandbox selector
- `Open Terminal` action

### Rules

- the sandbox selector is always visible when a project is open
- `Open Terminal` is available from anywhere in the main workspace
- top bar actions must not hide the current project or sandbox context
- the top bar should stay compact and mode-like rather than becoming a dense IDE toolbar
- the sidebar toggle button highlights when the sidebar is collapsed as a visual reminder

## Chat Workspace

The Chat workspace is the command center.

It should use a 3-region composition:

- left sidebar (collapsible)
- center chat pane
- right thread pane

The chat and thread panes are resizable via a vertical drag handle between them. Both have a minimum width of 200px.

The sidebar can be collapsed via a toggle button in the title bar or with Cmd+B. When collapsed, the chat and thread panes reclaim the sidebar's space. Sidebar collapse state is persisted per-project.

The terminal lives as a bottom drawer inside the chat workspace rather than as a separate page or bottom-right pane.

## Chat Workspace Layout

### Left Sidebar

Purpose:

- project navigation
- chat navigation inside the active project
- lightweight workflow entry points

Contents:

- project list
- new project action
- active project's chat list
- pinned chats
- archived chats entry
- lightweight global actions such as `New Chat`

Allowed actions:

- open project
- select project
- create chat
- select chat
- rename chat
- pin or unpin chat
- archive or restore chat

### Center Chat Pane

Purpose:

- active top-level chat
- plan and spec review
- natural-language workflow control
- direct coding requests when the user wants them

Core contents:

- chat header
- rolling message transcript
- structured approval blocks for plans and specs
- inline references to threads and chats when relevant
- chat input dock
- thread-aware review actions when a selected sandbox is reviewable
- terminal drawer anchored to the bottom

The chat input dock should support typed input, voice-to-text input, drag-and-drop, and picker-based file attachment.

### Right Thread Pane

Purpose:

- thread list
- thread detail
- execution visibility for the active chat and project

The thread pane occupies the full height of the right column. There is no separate status pane below it — runtime health information is accessible from the Settings page instead.

The boundary between the chat pane and thread pane is a drag handle that allows resizing the split. Both panes have a minimum width of 200px.

Default behavior:

- shows thread cards for the active project or active chat scope
- each thread row is collapsible
- selecting a thread expands it into detail in the same pane
- only one thread is expanded at a time by default

Thread detail should include:

- thread header
- state pills
- summary
- active sandbox and branch context
- coordinator conversation as the main body
- tabs for `Overview`, `Timeline`, `Agents`, `Files`, `Approvals`, `Logs`
- coordinator input dock at the bottom

The coordinator input dock reuses the same voice-input component and file-attachment input pattern as the main chat input.

### Thread Pane Interaction Model

The thread pane should feel like a focused execution surface, not a raw orchestration dashboard.

The user should primarily interact with:

- one coordinator conversation per thread
- thread status and timeline
- thread review actions
- thread sandbox and terminal actions

Worker or swarm detail should remain secondary and live under `Agents` or `Logs`.
The user should not need to talk to individual workers directly in v1.

### Bottom Drawer

Purpose:

- local testing
- saved command execution
- terminal session reuse
- runtime file sync visibility

Contents:

- terminal tabs or sessions scoped to the active project
- current sandbox label
- runtime file sync status
- saved command shortcuts such as `test`, `dev`, `lint`, `build`
- explicit action to change the active sandbox before launching a new session

### Drawer Behavior

- `Open Terminal` from the top bar opens or focuses the drawer
- new sessions inherit the active sandbox path
- switching sandboxes affects new sessions, not already-running sessions
- the terminal drawer can be collapsed without losing its sessions
- terminal state should persist long enough to support normal review loops

## External Handoff

Ultra should support pragmatic external handoff from the Chat workspace for tasks that are not part of the core v1 loop.

Examples:

- open the active sandbox in a user-chosen editor
- open the active branch or PR in GitHub
- open a target URL in the system browser

These are utility actions, not top-level pages.

## Navigation Model

### Project Selection

Project selection should set the root scope for:

- chats
- threads
- runtime
- sandbox contexts
- layout state

### Chat Selection

Selecting a chat should:

- update the active chat
- load its transcript
- update the center pane
- update the right thread pane to the chat's execution context when appropriate

### Thread Selection

Selecting a thread from the right pane should:

- update the selected thread
- load thread snapshot, events, agents, approvals, and logs as needed
- offer sandbox and terminal actions without leaving the chat workspace
- keep the coordinator conversation anchored to that thread's durable context even if the underlying execution backend restarts

### Terminal Launch

Opening the terminal should:

- resolve the current active sandbox
- open or focus the bottom drawer
- keep chat and thread context visible

## Layout Persistence

The layout model should preserve:

- active project
- active chat
- selected thread
- active sandbox
- terminal drawer open or closed state
- thread pane collapsed state if collapsible
- sidebar collapsed state
- chat/thread pane split ratio

It should not preserve obsolete editor or browser page routing in the v1 direction. The Settings page is not persisted as a page — the user always restores to their last workspace page on restart.
