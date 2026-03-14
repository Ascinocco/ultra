# Milestone 3: Editor Review Loop

## Goal

Make the Editor page real by implementing the active editor target model, thread review flow, `.env` sync, terminal integration, and request-changes/approve flow.

## Why Third

The product is not credible until a user can move from chat-driven planning into code review and testing without leaving Ultra.

## Scope

- Editor page shell
- active editor target selector
- open thread in editor flow
- main checkout vs thread checkout selection
- managed copy runtime file sync for `.env`
- terminal launch in active target
- run/debug targeting model
- diff and changed-files entry points
- request changes action
- approve action

## Deliverables

- selecting `Open in Editor` from a thread switches to Editor page
- active target is set to the thread checkout
- `.env` sync runs for the active target
- new terminals launch in the active target path
- run/debug actions use the active target path
- user can request changes or approve from review flow

## Out of Scope

- full publish flow
- advanced env management
- multi-target editor layouts
- browser-based QA automation

## Technical Decisions To Respect

- editor target is a concrete checkout path
- branch is metadata, not the primary selector object
- review should prefer switching the editor page to the thread checkout
- user should not need to manually reopen a worktree as a separate project

## Exit Criteria

- a thread can reach `awaiting_review`
- user can open it in Editor
- user can test/debug in the right checkout with synced `.env`
- user can drive the thread back to running or to approved

## Main Risks

- editor embedding complexity
- environment drift across worktrees
- making the editor target model too clever or too implicit
