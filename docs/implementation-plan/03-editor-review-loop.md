# Milestone 3: Sandbox Terminal Workflow

## Goal

Make the chat workspace the real testing and approval loop by implementing active sandbox selection, runtime file sync, integrated terminal sessions, saved test commands, and thread-aware request-changes and approve actions.

## Why Third

The product is not credible until a user can move from chat-driven planning into local testing and approval without manually recreating environment files or remembering the right checkout path.

## Scope

- multiple projects and chats continue to anchor the shell
- active sandbox selector in the top bar and thread actions
- thread sandbox versus main checkout selection
- managed-copy runtime file sync for `.env`
- integrated terminal drawer in the chat workspace
- one-click terminal launch from the top bar
- saved command targeting for the active sandbox
- request changes action
- approve action
- pragmatic external handoff to editor and GitHub when needed

## Deliverables

- selecting a thread sandbox makes it the active testing context
- `.env` sync runs for the active sandbox
- `Open Terminal` launches or focuses a terminal in that sandbox path
- saved commands use the active sandbox path
- user can request changes or approve from the chat and thread workflow

## Out of Scope

- embedded editor requirement
- embedded browser requirement
- custom diff review UI
- advanced env management
- user-facing worktree management
- browser-based QA automation

## Technical Decisions To Respect

- the active testing context is a concrete checkout path exposed as a `sandbox`
- branch is metadata, not the primary selector object
- the integrated terminal lives in the chat workspace
- the user should not need to manually reopen a sandbox as a separate project
- Overstory remains the default backend for thread execution, but it is not the primary user-facing concept
- the user interacts with a thread coordinator conversation rather than raw swarm members
- external handoff is acceptable for full file, diff, and browser work

## Exit Criteria

- a thread can reach `awaiting_review`
- user can select that thread's sandbox
- user can test or debug in the right checkout with synced `.env`
- user can request changes or approve from the same workspace

## Main Risks

- environment drift across hidden worktree-backed sandboxes
- confusing sandbox identity in the shell
- terminal and saved-command behavior that feels implicit or surprising
