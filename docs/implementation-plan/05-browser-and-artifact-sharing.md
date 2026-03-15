# Milestone 5: External QA and Artifact Handoff

## Goal

Add pragmatic external QA and artifact handoff so the user can move from Ultra's chat and terminal workflow into external browser, editor, and GitHub surfaces when needed without losing context.

## Why Fifth

External QA and artifact handoff are valuable, but they should come after the core planning, execution, testing, and approval loop is already working.

The browser is a convenience capability, not the core product loop.

## Scope

- external handoff actions such as `Open in Browser`, `Open in Editor`, and `Open in GitHub`
- artifact sharing from terminal/runtime surfaces into chats and threads
- optional browser or QA helpers only after the handoff path is stable
- destination picker behavior
- `Share All`
- combined runtime plus artifact context share

## Deliverables

- user can hand off to the system browser or preferred editor from the active worktree context
- runtime artifacts can be shared into chats and threads
- `Share All Context` works for terminal/runtime-centered debugging
- any future browser convenience surface remains optional and downstream of the handoff model

## Out of Scope

- requiring an embedded Browser page
- requiring an embedded side browser
- deeply complex browser profile management
- in-product diff review

## Technical Decisions To Respect

- external handoff is acceptable and preferred over heavyweight embedding in v1
- artifact sharing is explicit and user-mediated
- browser and editor convenience features should not reshape the core chat-plus-terminal architecture
- split views or embedded surfaces are optional follow-ons, not milestone prerequisites

## Exit Criteria

- user can hand off to browser/editor/GitHub from Ultra with the correct worktree context
- user can share runtime artifacts into a chosen chat or thread
- `Share All Context` can bundle the useful terminal/runtime debugging state

## Main Risks

- context loss during handoff
- oversized artifacts flooding chat/thread context
- accidental product creep back toward heavyweight embedded browser/editor surfaces
