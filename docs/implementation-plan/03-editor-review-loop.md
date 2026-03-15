# Milestone 3: Worktree Terminal Workflow

## Goal

Make the chat workspace the real testing and approval loop by implementing active worktree selection, runtime file sync, integrated terminal sessions, saved test commands, and thread-aware request-changes/approve actions.

## Why Third

The product is not credible until a user can move from chat-driven planning into local testing and approval without manually recreating environment files or remembering the right worktree path.

## Scope

- active worktree selector in the shell
- thread worktree vs main checkout selection
- managed copy runtime file sync for `.env`
- integrated terminal drawer in the chat workspace
- one-click terminal launch from the top bar
- saved command targeting for the active worktree
- request changes action
- approve action
- pragmatic external handoff to editor/GitHub when needed

## Deliverables

- selecting a thread worktree makes it the active testing context
- `.env` sync runs for the active worktree
- `Open Terminal` launches or focuses a terminal in that worktree path
- saved commands use the active worktree path
- user can request changes or approve from the chat/thread workflow

## Out of Scope

- embedded editor requirement
- embedded browser requirement
- custom diff review UI
- advanced env management
- multi-target editor layouts
- browser-based QA automation

## Technical Decisions To Respect

- the active testing context is a concrete checkout path
- branch is metadata, not the primary selector object
- the integrated terminal lives in the chat workspace
- the user should not need to manually reopen a worktree as a separate project
- external handoff is acceptable for full file or diff review

## Exit Criteria

- a thread can reach `awaiting_review`
- user can select that thread's worktree
- user can test/debug in the right checkout with synced `.env`
- user can request changes or approve from the same workspace

## Main Risks

- environment drift across worktrees
- confusing worktree identity in the shell
- terminal/session behavior that feels implicit or surprising
