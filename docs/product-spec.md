# Ultra Product Spec

## Status

Draft v0.1

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

It is designed for a single engineer working on real repositories who wants to plan, break down, launch, supervise, review, and test software work from one place. Ultra should feel like a command center for engineering work, with the testing loop anchored by a worktree-aware terminal instead of a heavyweight embedded IDE.

Ultra's v1 product surface is centered on one primary workspace:

- `Chat workspace`: planning, research, ticket intake, specs, execution thread creation, thread supervision, worktree selection, terminal use, and approval actions

Supporting surfaces remain lightweight:

- `System & Tools`: operational and readiness settings
- external handoff to the user's preferred editor, GitHub review surface, or browser when needed

## Product Thesis

Existing coding tools are usually optimized for either:

- editing code with AI attached as a side panel
- raw terminal-driven agent execution with weak review and workspace UX

Ultra should do something more opinionated:

- make chat the primary planning interface
- make execution visible and inspectable through threads
- make local testing and debugging happen through a worktree-aware terminal loop
- keep the user inside one product for the core path from idea to tested changes, while allowing external handoff for full diff review or browser work when needed

## Target User

- Single-user software engineers
- macOS and Linux desktop users
- People working in real local repos
- Users comfortable with AI-assisted and agentic workflows
- Users who want to supervise autonomous work, not just autocomplete code

## Non-Goals

- Multi-user collaboration in v1
- Web app
- Windows support in v1
- Requiring an embedded editor in v1
- Requiring an embedded browser in v1
- Building a custom terminal emulator
- Surfacing internal Overstory/Seeds mechanics as the primary UX
- Owning MCP configuration for the user

## Core Product Objects

### Project

A project is the user’s local codebase and the root scope for chats, threads, worktree contexts, and backend supervision.

### Chat

A chat is a long-lived, project-scoped conversation.

Chats are used for:

- planning
- ticket intake
- research
- external context gathering through the user’s chosen CLI/tooling stack
- plan review and approval
- direct CLI-style coding interaction when desired

Chats are not the same as execution threads. They are where work is framed and decisions are made.

### Thread

A thread is the persistent execution object created when approved work is broken into specs and implementation starts.

A thread owns:

- execution context
- spec references
- coordinator conversation
- worktree
- branch
- review lifecycle
- publish lifecycle
- activity history

Threads are the main unit of autonomous work in Ultra.

### Worktree Context

A worktree context is the concrete checkout path Ultra is currently targeting for testing and review.

The active worktree context determines:

- terminal cwd
- saved command root
- runtime file sync behavior
- thread-aware review actions
- external handoff target

## User Experience Overview

### Chat Page

The default home of the product is a 3-pane command center.

#### Left Rail

- project chats
- pinned chats
- archived chats

#### Left Main Pane

- active top-level chat
- plan/spec discussion
- direct CLI-style interaction when needed
- worktree-aware terminal launch and review decisions when needed

#### Right Top Pane

- infinitely scrollable list of execution threads
- thread cards with status and health
- expandable thread detail with coordinator interaction

#### Right Bottom Pane

- live swarm/coordinator activity
- worker progress
- logs
- approvals
- operational health indicators

### Terminal Workflow

The terminal workflow is the place for:

- selecting the right worktree
- syncing runtime files such as `.env`
- opening or reusing a terminal in the correct cwd
- running tests, dev servers, lint, and build commands
- deciding whether to request changes or approve a thread

The active worktree context can be the main checkout or a thread worktree.
This workflow lives inside the main chat workspace instead of a separate Editor page.

## Core Workflow

1. User opens a project in Ultra.
2. User works in a project chat to discuss a task, ticket, bug, or feature.
3. Chat pulls in relevant context using the user’s chosen toolchain where appropriate.
4. Chat proposes a plan.
5. User reviews and approves the plan.
6. Chat proposes a spec breakdown.
7. User reviews and approves the specs.
8. User chooses to start work.
9. Ultra creates a thread and starts execution through the coordinator.
10. The thread appears in the right pane with live status and coordinator interaction.
11. When review is ready, the user selects the relevant thread worktree.
12. Ultra syncs runtime files and opens or reuses a terminal in that worktree.
13. User tests, debugs, and either requests changes or approves.
14. After approval, Ultra finalizes publish actions according to project policy.

## Product Principles

- Chat-first, not sidebar-assistant-first
- Threads are the visible unit of autonomous execution
- Testing and debugging should happen in a worktree-aware terminal workflow
- The user should not need to recreate env files or remember the right cwd for a thread worktree
- Ultra should keep the user inside one shell for the core test-and-approve loop while staying pragmatic about external handoff
- The UI should expose progress, state, and health without drowning the user in process noise
- Advanced behavior should be configurable, but the default path should stay simple
- Ultra app chrome is dark-only

## Theme and Customization Policy

Ultra should ship with a dark theme and should not support:

- light mode
- theme toggling
- multiple built-in app themes
- user-defined app chrome themes

The intended feel is dark, but not oppressively dark. The app should be comfortable for mainstream users, not only dark-mode maximalists.

### External Tool Exception

When Ultra hands off to an external editor or browser, those tools keep their own theming and keybinding models.

This customization boundary applies to the external tool, not the Ultra app shell.

## Execution Model

- One project has many chats
- One project can have many threads
- Threads are created from approved chat work
- Thread identity remains stable even if the coordinator restarts
- One project has one top-level coordinator
- Overstory may fan out as many workers as it wants behind that coordinator
- Ultra monitors coordinator/watch health rather than micromanaging worker scheduling

## Review Model

- Autonomous work should converge to `awaiting_review`
- A reviewable worktree and branch must exist for the thread
- The user selects that worktree in Ultra and tests it from the integrated terminal workflow
- Thread-specific review actions belong primarily in thread UI
- The main chat can still trigger related actions when useful
- Approval completes the thread
- Publish is a separate lifecycle that usually happens after approval

## Worktree Terminal Model

- Ultra has a single active worktree context per project
- A worktree context is a concrete checkout path
- Branch is visible metadata, not the primary selector object
- New terminals open in the active worktree path
- Saved commands use the active worktree path
- Runtime files such as `.env` are mirrored into the active worktree by default
- External editor or GitHub handoff should target the active worktree when relevant

## Integration Model

- Ultra does not own MCP configuration in the current direction
- Users configure external context and tooling through their chosen CLI environment
- Ultra focuses on orchestrating the workflow and providing a coherent product experience on top

## Technical Direction

The exact packaging/runtime architecture is still being refined, but the product direction assumes:

- a desktop app experience
- a chat-first command-center UI
- a worktree-aware terminal workflow for local testing
- external handoff for full editor, diff, and browser tasks when needed
- local speech-to-text input for chat surfaces
- ephemeral file upload for chat surfaces
- a backend/runtime layer capable of supervising threads and coordinators reliably

## What Ultra Must Feel Like

Ultra should feel like:

- a command center for engineering work
- a place where planning and execution are clearly separated
- a place where autonomous work is visible, steerable, and reviewable
- a place where the user can move from intent to testing without leaving the product

It should not feel like:

- a generic editor with a chat sidebar
- a thin wrapper around terminal agents
- a project management tool with code attached
- a theme-heavy customization playground

## v1 Priorities

1. Chat page with multi-chat support
2. Thread creation and supervision
3. Coordinator conversation inside thread detail
4. Worktree selector and integrated terminal drawer
5. Runtime file sync and saved test/dev commands for the active worktree
6. Basic publish flow with draft PR support
7. Health indicators for backend, coordinator, and watch processes

## Open Areas

These areas still need their own detailed specs:

- chat contract
- thread event schema
- coordinator runtime and watchdog model
- publish policy and branch/PR templates
- runtime file sync details
- packaging and distribution model
