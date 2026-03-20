# Ultra Product Spec

## Status

Draft v0.2

This is the entry-point product spec for Ultra. It describes the overall product shape, user workflow, primary abstractions, and the current v1 direction. Detailed subsystem behavior lives in supporting docs.

Supporting specs:

- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [cli-runtime-contract.md](/Users/tony/Projects/ultra/docs/cli-runtime-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [worktree-terminal-model.md](/Users/tony/Projects/ultra/docs/worktree-terminal-model.md)
- [electron-host-boundaries.md](/Users/tony/Projects/ultra/docs/electron-host-boundaries.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)
- [ui-layout-and-navigation.md](/Users/tony/Projects/ultra/docs/ui-layout-and-navigation.md)
- [artifact-sharing.md](/Users/tony/Projects/ultra/docs/artifact-sharing.md)
- [voice-input.md](/Users/tony/Projects/ultra/docs/voice-input.md)
- [file-attachments.md](/Users/tony/Projects/ultra/docs/file-attachments.md)
- [implementation-plan/implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [wiring/wiring.md](/Users/tony/Projects/ultra/docs/wiring/wiring.md)

## Product Summary

Ultra is a chat-first desktop environment for software engineering.

It is designed for a single engineer working across real repositories who wants to plan, break down, launch, supervise, test, and approve software work from one place. Ultra should feel like a command center for engineering work, with the testing loop anchored by a chat-page terminal and a hidden sandbox model instead of a heavyweight embedded IDE.

Ultra's v1 product surface is centered on one primary workspace:

- `Chat workspace`: planning, research, ticket intake, spec review, execution thread creation, thread supervision, sandbox selection, terminal use, and approval actions

Supporting surfaces remain lightweight:

- `Settings` (runtime status and future configuration)
- `System & Tools`
- external handoff to the user's preferred editor, GitHub review surface, or browser when needed

## Product Thesis

Existing coding tools are usually optimized for either:

- editing code with AI attached as a side panel
- raw terminal-driven agent execution with weak project, thread, and review UX

Ultra should do something more opinionated:

- make chat the primary planning interface
- make projects and chats durable everyday objects instead of one-project-per-window state
- make execution visible and inspectable through threads
- make local testing and debugging happen through a sandbox-aware terminal loop
- hide internal orchestration details like worktrees and worker fan-out behind simple project, chat, thread, and terminal concepts

## Target User

- single-user software engineers
- macOS and Linux desktop users
- people working in real local repos
- users comfortable with AI-assisted and agentic workflows
- users who want to supervise autonomous work, not just autocomplete code

## Non-Goals

- multi-user collaboration in v1
- web app
- Windows support in v1
- requiring an embedded editor in v1
- requiring an embedded browser in v1
- building a custom terminal emulator
- surfacing worktrees as a primary user-facing concept
- surfacing internal orchestration mechanics as the main UX
- owning MCP configuration for the user

## Core Product Objects

### Project

A project is a local codebase and the root scope for:

- chats
- threads
- sandbox contexts
- terminal sessions
- runtime supervision
- layout state

Ultra supports many projects in the sidebar. The user should not need one app instance per project.

### Chat

A chat is a long-lived, project-scoped conversation.

Chats are used for:

- planning
- ticket intake
- research
- external context gathering through the user's chosen CLI/tooling stack
- plan review and approval
- direct CLI-style coding interaction when desired

Chats are not the same as execution threads. They are where work is framed and decisions are made.

### Thread

A thread is the persistent execution object created when approved work is broken into specs and implementation starts.

A thread owns:

- execution context
- spec references
- coordinator conversation
- branch metadata
- sandbox association
- review lifecycle
- publish lifecycle
- activity history

Threads are the main unit of autonomous work in Ultra.

### Sandbox Context

A sandbox context is the concrete checkout Ultra is currently targeting for testing and review.

The active sandbox determines:

- terminal cwd
- saved command root
- runtime file sync behavior
- thread-aware approval actions
- external handoff target

The user-facing concept is `sandbox`, not `worktree`.
Internally, a sandbox may be backed by the project root or an orchestration-managed worktree.

## User Experience Overview

### Chat Page

The default home of the product is a chat-first command center.

#### Left Sidebar

- multiple projects
- chats for the active project
- pinned or recent chats
- archived chat access
- collapsible via title bar toggle button or Cmd+B (state persisted per-project)

#### Main Chat Pane

- active chat transcript
- plan/spec discussion
- direct CLI-style interaction when needed
- thread-aware review actions
- terminal drawer anchored to the bottom of the page

#### Right Thread Pane

- infinitely scrollable list of execution threads for the active chat or project scope
- collapsible thread cards with status, health, and attention state
- one expanded thread detail at a time
- expandable thread detail with one primary coordinator conversation
- full-height thread pane (no status section below)
- resizable via drag handle between chat and thread panes (200px minimum both sides)

Runtime health information is accessible from the Settings page rather than occupying space in the main workspace.

### Terminal Workflow

The terminal workflow is the place for:

- selecting the right sandbox
- syncing runtime files such as `.env`
- opening or reusing a terminal in the correct cwd
- running tests, dev servers, lint, and build commands
- deciding whether to request changes or approve a thread

The active sandbox can be the main project checkout or a thread sandbox.
This workflow lives inside the main chat workspace instead of a separate Editor page.

## Core Workflow

1. User opens Ultra and sees many projects in the sidebar.
2. User selects a project and works in one of its chats.
3. Chat pulls in relevant context using the user's chosen toolchain where appropriate.
4. Chat proposes a plan.
5. User reviews and approves the plan.
6. Chat proposes a spec breakdown.
7. User reviews and approves the specs.
8. User chooses to start work.
9. Ultra creates a thread and starts execution through the project coordinator.
10. Sub-agents execute behind that thread, but the user stays focused on the chat and thread surfaces.
11. The thread appears in the right pane with live status and one coordinator conversation that represents the execution context.
12. When review is ready, the user selects the relevant sandbox from thread UI or the top bar.
13. Ultra syncs runtime files and opens or reuses a terminal in that sandbox.
14. User tests, debugs, and either requests changes or approves.
15. After approval, Ultra finalizes publish actions according to project policy.

## Product Principles

- chat-first, not sidebar-assistant-first
- projects and chats are first-class everyday objects
- threads are the visible unit of autonomous execution
- Ultra's orchestration layer remains the default execution backend for thread work, but it stays behind the product boundary
- testing and debugging should happen through a sandbox-aware terminal workflow
- the user should not need to recreate env files or remember the right cwd for a thread sandbox
- Ultra should keep the user inside one shell for the core test-and-approve loop while staying pragmatic about external handoff
- the UI should expose progress, state, and health without drowning the user in process noise
- the user interacts with a thread coordinator, not directly with swarm members
- advanced orchestration should be observable, not vocabulary the user has to learn
- Ultra app chrome is dark-only

## Theme and Customization Policy

Ultra should ship with a dark theme and should not support:

- light mode
- theme toggling
- multiple built-in app themes
- user-defined app chrome themes

### External Tool Exception

When Ultra hands off to an external editor or browser, those tools keep their own theming and keybinding models.

This customization boundary applies to the external tool, not the Ultra app shell.

## Execution Model

- one user workspace can have many projects
- one project has many chats
- one project can have many threads
- threads are created from approved chat work
- thread identity remains stable even if the coordinator restarts
- one project has one top-level coordinator
- Ultra's orchestration layer may fan out as many sub-agents as it wants behind that coordinator
- Ultra monitors coordinator and worker health through thread projections rather than exposing raw orchestration primitives as the main UX
- the coordinator remains the stable conversational identity for the thread even if providers or workers change underneath

## Review Model

- autonomous work should converge to `awaiting_review`
- a reviewable sandbox and branch must exist for the thread
- the user selects that sandbox in Ultra and tests it from the integrated terminal workflow
- thread-specific review actions belong primarily in thread UI
- the main chat can still trigger related actions when useful
- approval completes the thread
- publish is a separate lifecycle that usually happens after approval

## Sandbox Terminal Model

- Ultra has a single active sandbox per project
- a sandbox is a concrete checkout path with project and optional thread metadata
- branch is visible metadata, not the primary selector object
- new terminals open in the active sandbox path
- saved commands use the active sandbox path
- runtime files such as `.env` are mirrored into the active sandbox by default
- external editor or GitHub handoff should target the active sandbox when relevant

## Integration Model

- Ultra does not own MCP configuration in the current direction
- users configure external context and tooling through their chosen CLI environment
- Ultra focuses on orchestrating the workflow and providing a coherent product experience on top

## Technical Direction

The current v1 direction assumes:

- a desktop app experience
- a chat-first command-center UI
- multiple projects in one shell
- a right-side thread panel tied to the active chat context
- a sandbox-aware terminal workflow for local testing
- Ultra's orchestration layer as the default backend for thread execution
- external handoff for full editor, diff, and browser tasks when needed
- local speech-to-text input for chat surfaces

## Summary

Ultra v1 is not a browser, not an IDE, and not a thin wrapper around raw agent terminals.

It is a chat-centered engineering workspace where:

- projects organize the user’s local work
- chats frame and coordinate tasks
- threads supervise autonomous execution
- sandboxes hide checkout complexity
- the terminal drawer closes the loop between generated changes and local testing
