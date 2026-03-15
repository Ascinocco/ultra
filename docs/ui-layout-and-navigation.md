# Ultra UI Layout and Navigation

## Status

Draft v0.1

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

- chats are the primary planning surface
- threads are the primary execution surface
- testing/debugging happens through a worktree-aware terminal workflow
- runtime status should be visible without becoming an ops console

## Top-Level Navigation

Ultra v1 should center the product on a single primary workspace:

- `Chat`

Supporting destinations can remain lightweight:

- `System & Tools`
- external handoff actions such as `Open in Editor`, `Open in GitHub`, or `Open in Browser`

### Product Rule

The user should be able to stay in `Chat` for planning, execution supervision, worktree selection, testing, and approval. Opening a terminal should feel like extending the chat workspace, not leaving it.

## Global Frame

At the top level, Ultra should maintain a consistent app frame with:

- current project identity
- active worktree selector
- quick terminal action
- project runtime health indicator
- settings or system tools entry

## App Theme Policy

The Ultra application shell should be dark-only.

### Rules

- no light theme
- no app-level theme toggle
- no multiple app shell themes
- no user-defined app shell themes

The visual direction should be dark, but not extremely dark or hostile to less technical users.

### External Tool Boundary

External tools may visually diverge because they keep their own themes and keybindings.

This is acceptable because Ultra no longer treats those tools as first-class embedded pages in v1.

## Top Bar

The top bar should feel closer to a command header than a page switcher.

For v1, it should include:

- current project identity
- active worktree selector
- `Open Terminal` action
- project runtime health
- entry point to `System & Tools`

### Rules

- the worktree selector is always visible when a project is open
- `Open Terminal` is available from anywhere in the main workspace
- top bar actions must not hide the current project or worktree context
- the top bar should stay compact and mode-like rather than becoming a dense IDE toolbar

## Chat Workspace

The Chat workspace is the command center.

It should use a 3-region composition:

- left rail plus left main pane
- top-right pane
- bottom-right pane

## Chat Workspace Layout

### Left Rail

Purpose:

- project chat navigation
- chat lifecycle management

Contents:

- new chat action
- pinned chats
- active chats
- archived chats entry

Allowed actions:

- create chat
- select chat
- rename chat
- pin/unpin chat
- archive/restore chat

### Left Main Pane

Purpose:

- active top-level chat
- plan/spec review
- natural-language workflow control
- direct coding requests when the user wants them

Core contents:

- chat header
- rolling message transcript
- structured approval blocks for plans and specs
- inline references to threads/chats when relevant
- chat input dock
- thread-aware review actions when a selected worktree is reviewable

The chat input dock should support both typed input and voice-to-text input.
It should also support drag-and-drop and picker-based file attachment.

### Top-Right Pane

Purpose:

- thread list
- thread detail

Default behavior:

- shows infinitely scrollable thread cards for the project
- selecting a thread expands it into detail in the same pane

Thread detail should include:

- thread header
- state pills
- summary
- tabs for `Overview`, `Timeline`, `Agents`, `Files`, `Approvals`, `Logs`
- coordinator input dock at the bottom

The coordinator input dock reuses the same voice-input component and file-attachment input pattern as the main chat input.

### Bottom-Right Pane

Purpose:

- live execution and runtime status visibility

Contents:

- project runtime health summary
- coordinator/watch/watchdog health
- live swarm activity summary
- recent important log/status lines
- pending approval count

### Pane Behavior

The top-right and bottom-right panes should both be independently collapsible.

This supports two important modes:

- thread-focused mode: expand top-right, collapse bottom-right
- runtime-focused mode: expand bottom-right, collapse top-right

The left chat pane should remain the anchor of the page.

## Terminal Drawer

The integrated terminal should live inside the Chat workspace as a drawer or bottom pane.

### Purpose

- run tests in the active worktree
- launch dev servers
- execute lint/build commands
- inspect command output without losing thread context

### Contents

- terminal tabs or sessions scoped to the active project
- current worktree label
- runtime file sync status
- saved command shortcuts such as `test`, `dev`, `lint`, `build`
- explicit action to change the active worktree before launching a new session

### Behavior Rules

- `Open Terminal` from the top bar opens or focuses this drawer
- new sessions inherit the active worktree path
- switching worktrees affects new sessions, not already-running sessions
- the terminal drawer can be collapsed without losing its sessions
- terminal state should persist long enough to support normal review loops

## External Handoff

Ultra should support pragmatic external handoff from the Chat workspace for tasks that are not part of the core v1 loop.

Examples:

- open the active worktree in a user-chosen editor
- open the active branch or PR in GitHub
- open a target URL in the system browser

These are utility actions, not top-level pages.

## Navigation Model

### Project Selection

Project selection should set the root scope for:

- chats
- threads
- runtime
- worktree contexts
- layout state

### Chat Selection

Selecting a chat should:

- update the active chat
- load its transcript
- update the left main pane
- preserve the currently selected thread if still relevant

### Thread Selection

Selecting a thread from the top-right pane should:

- update the selected thread
- load thread snapshot, events, agents, approvals, and logs as needed
- update the thread detail view
- not force a chat switch unless explicitly requested

### Worktree Selection

When the user changes the active worktree:

- update the active worktree context for the project
- refresh runtime sync status
- use that worktree for new terminal sessions and saved commands
- preserve already-running terminal sessions

### Open Terminal

When the user clicks `Open Terminal` from the top bar or thread UI:

- focus or reveal the terminal drawer
- use the current active worktree by default
- allow the user to confirm or switch worktree context before launching a new terminal session when needed

This is one of the most important transitions in the v1 product loop.

## Cross-Surface State

Certain state should persist while the user moves around the main workspace:

- active project
- active chat
- selected thread
- active worktree
- pane collapse state
- selected right/bottom tabs
- terminal drawer visibility

### Product Rule

Changing worktrees or opening the terminal should feel like moving between modes of one system, not opening separate apps.

## Primary User Flows

### Flow 1: Planning to Execution

1. user opens project
2. user selects or creates a chat
3. user discusses task
4. user approves plan
5. user approves specs
6. user confirms start work
7. thread appears in top-right pane

### Flow 2: Monitoring Work

1. user stays in the Chat workspace
2. top-right thread pane shows execution state
3. bottom-right pane shows runtime health and activity
4. user can message coordinator in thread detail

### Flow 3: Testing and Review

1. thread reaches `awaiting_review`
2. user selects the thread worktree
3. Ultra syncs runtime files if needed
4. user opens or focuses the integrated terminal
5. user runs tests, dev commands, or other local verification
6. user requests changes or approves

### Flow 4: Return to Planning

1. user collapses the terminal or shifts focus back to chat
2. same active project/chat/thread state is restored
3. user continues planning or starts new work

## Visual Priority

The UI should make these priorities obvious:

1. active conversation and decisions
2. active execution threads
3. runtime/system health
4. worktree-aware terminal workflow when explicitly opened

This prevents the product from feeling like a noisy ops dashboard.

## State Presentation Rules

### Chats

Show:

- title
- pin state
- last activity
- provider/model summary when useful

Avoid:

- too much config noise in the sidebar

### Threads

Show:

- title
- execution state
- review state
- publish state
- last activity
- health indicator

Avoid:

- raw internal Overstory terms unless they help the user

### Runtime

Show:

- concise health states
- blocked/degraded reasons
- latest meaningful activity

Avoid:

- low-level process trivia as the default view

## Layout Persistence

Persist per-project layout state for:

- active chat
- selected thread
- right-top collapsed state
- right-bottom collapsed state
- selected thread tab
- selected bottom panel tab
- last active worktree
- terminal drawer open state

This matches the existing schema and IPC assumptions.

## Component Hierarchy

Recommended high-level React hierarchy:

- `AppShell`
- `ProjectFrame`
- `TopBar`
- `ChatPage`
- `TerminalDrawer`

Recommended Chat page composition:

- `ChatPage`
- `ChatRail`
- `ActiveChatPane`
- `ThreadPane`
- `StatusPane`
- `TerminalDrawer`

Recommended Thread pane composition:

- `ThreadPane`
- `ThreadList`
- `ThreadCard`
- `ThreadDetail`
- `ThreadTabs`
- `CoordinatorInput`

Recommended Status pane composition:

- `StatusPane`
- `RuntimeHealthSummary`
- `SwarmActivityFeed`
- `PendingApprovalsSummary`

## Frontend Store Expectations

The UI layout should align with a normalized frontend store.

Important selectors:

- `activeProject`
- `activeChat`
- `selectedThread`
- `projectThreads`
- `projectRuntime`
- `activeWorktree`
- `projectWorktrees`
- `layoutState`
- `terminalSessions`

The layout should not depend on nesting all state under the active chat.

## Responsive Behavior

Ultra is desktop-first, but the layout should still degrade sensibly on smaller windows.

Recommended behavior:

- allow pane resizing
- collapse right-bottom pane first when width/height is constrained
- preserve access to thread list even when thread detail is expanded
- preserve access to chat input at all times on the Chat page

## Out of Scope for v1

- fully detachable multi-window workspaces
- arbitrary pane graph layout editing
- collaborative cursors or multi-user presence
- user-programmable dashboard layouts

## Locked Decisions

1. Ultra v1 centers the product on a single Chat workspace
2. The Chat workspace is the command center
3. The integrated terminal lives inside that workspace rather than on a separate Editor page
4. The top bar always exposes project identity, worktree selection, and `Open Terminal`
5. The Chat workspace uses left chat, top-right thread, bottom-right status layout
6. Top-right and bottom-right panes are independently collapsible
7. Worktree selection is the primary testing/review context switch
8. External editor, GitHub, and browser handoff are utility actions rather than top-level pages
9. Cross-surface state persists per project
10. The app shell uses one fixed dark theme with no user-selectable shell themes
11. New-project empty states should direct the user toward creating a chat or opening a project, and no-thread states should keep the thread pane visible with a clear “no threads yet” placeholder
12. Review-ready and degraded-runtime notifications appear as in-app toasts plus persistent indicators in the relevant page headers or status regions
