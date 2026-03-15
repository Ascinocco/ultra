# Ultra UI Layout and Navigation

## Status

Draft v0.1

This document defines the top-level information architecture, page layout, navigation model, and major UI regions for Ultra.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Ultra needs a UI structure that makes the product feel like a command center instead of an editor with a side chat.

The layout should make these truths obvious:

- chats are the primary planning surface
- threads are the primary execution surface
- editing/testing/debugging happens on a separate page
- runtime status should be visible without becoming an ops console

## Top-Level Navigation

Ultra should have three primary pages:

- `Chat`
- `Editor`
- `Browser`

These are peer pages, not nested views.

### Product Rule

The user should be able to spend long stretches of time in `Chat` without feeling forced into the editor, and long stretches in `Editor` without losing context about the active thread or project.

## Global Frame

At the top level, Ultra should maintain a consistent app frame with:

- current project identity
- top navigation pills for page switching
- current page
- project runtime health indicator

## App Theme Policy

The Ultra application shell should be dark-only.

### Rules

- no light theme
- no app-level theme toggle
- no multiple app shell themes
- no user-defined app shell themes

The visual direction should be dark, but not extremely dark or hostile to less technical users.

### Editor Boundary

The Editor page may visually diverge because the embedded editor environment can use user-selected themes and customized keybindings.

This is acceptable.

## Top Navigation

Top-level navigation should work like Claude Desktop's mode switcher.

For v1, it should be exactly three pill-style navigation controls:

- `Chat`
- `Editor`
- `Browser`

### Rules

- the pills live at the top of the app frame
- one pill is always active
- switching pills changes the top-level page without losing project-scoped context
- this is navigation, not a tab strip for arbitrary pages

The visual treatment should feel simple, obvious, and mode-like rather than like a dense application toolbar.

## Page 1: Chat

The Chat page is the command center.

It should use a 3-region composition:

- left rail plus left main pane
- top-right pane
- bottom-right pane

## Chat Page Layout

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

## Editor Page

The Editor page is the coding and review environment.

It should center the active editor target and use embedded Code-OSS style editing surfaces for:

- files
- diffs
- terminals
- run/debug

## Editor Page Layout

### Top Bar

Contents:

- active editor target selector
- target metadata
- runtime file sync status
- project runtime health indicator

### Main Editor Region

Purpose:

- file editing
- diff review
- code navigation

This should feel like a code workspace, not a custom chat page with code bolted on.

### Bottom Panel

Purpose:

- terminals
- build/test output
- debug console

### Optional Side Surface

If the editor embedding model supports it cleanly, a lightweight thread context strip may appear alongside the editor showing:

- selected thread
- current review state
- open in thread action

This should be secondary, not a full second command center.

## Browser Page

The Browser page is the dedicated manual testing and browsing environment.

It should support:

- persistent manual browsing
- authenticated QA workflows
- bookmarks
- browser session continuity

This page is distinct from thread automation browser sessions.

## Side Browser

In addition to the Browser page, Ultra should support a side browser that can open from Chat or Editor.

### Side Browser Rules

- opens as a right-side vertical split
- is resizable
- is collapsible
- preserves the main page beneath it
- uses the manual browser context, not the automation browser context

## Navigation Model

### Project Selection

Project selection should set the root scope for:

- chats
- threads
- runtime
- editor targets
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

### Open In Editor

When the user clicks `Open in Editor` from thread or chat UI:

- switch to the Editor page
- set the thread's checkout as the active editor target
- sync runtime files when files are missing or stale
- optionally open changed files or diff view based on context

This is one of the most important page transitions in the product.

## Cross-Page State

Certain state should persist when moving between Chat and Editor:

- active project
- active chat
- selected thread
- last editor target
- pane collapse state
- selected right/bottom tabs

### Product Rule

Navigating between pages should feel like moving between modes of one system, not opening separate apps.

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

1. user stays on Chat page
2. top-right thread pane shows execution state
3. bottom-right pane shows runtime health and activity
4. user can message coordinator in thread detail

### Flow 3: Reviewing Work

1. thread reaches `awaiting_review`
2. user clicks `Open in Editor`
3. app switches to Editor page
4. active target changes to thread checkout
5. user tests, diffs, debugs, edits
6. user requests changes or approves

### Flow 4: Return to Planning

1. user switches back to Chat page
2. same active project/chat/thread state is restored
3. user continues planning or starts new work

## Visual Priority

The UI should make these priorities obvious:

1. active conversation and decisions
2. active execution threads
3. runtime/system health
4. editing and review when explicitly entered

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
- last editor target

This matches the existing schema and IPC assumptions.

## Component Hierarchy

Recommended high-level React hierarchy:

- `AppShell`
- `ProjectFrame`
- `TopNav`
- `PageRouter`
- `ChatPage`
- `EditorPage`

Recommended Chat page composition:

- `ChatPage`
- `ChatRail`
- `ActiveChatPane`
- `ThreadPane`
- `StatusPane`

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

Recommended Editor page composition:

- `EditorPage`
- `EditorTargetBar`
- `EditorWorkspace`
- `EditorBottomPanel`

## Frontend Store Expectations

The UI layout should align with a normalized frontend store.

Important selectors:

- `activeProject`
- `activeChat`
- `selectedThread`
- `projectThreads`
- `projectRuntime`
- `editorTargets`
- `layoutState`

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

1. Ultra has three primary pages: Chat, Editor, and Browser
2. The Chat page is the command center
3. The Editor page is the coding/review environment
4. The Browser page is the dedicated manual browser environment
5. The Chat page uses left chat, top-right thread, bottom-right status layout
6. Top-right and bottom-right panes are independently collapsible
7. `Open in Editor` is a primary cross-page action
8. Side browser split-view exists for Chat and Editor
9. Cross-page state persists per project
10. The app shell uses one fixed dark theme with no user-selectable shell themes
11. New-project empty states should direct the user toward creating a chat or opening a project, and no-thread states should keep the thread pane visible with a clear “no threads yet” placeholder
12. The Editor page does not include a thread context strip in v1
13. Review-ready and degraded-runtime notifications appear as in-app toasts plus persistent indicators in the relevant page headers or status regions
