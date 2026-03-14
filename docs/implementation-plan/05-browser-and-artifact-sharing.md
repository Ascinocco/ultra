# Milestone 5: Browser and Artifact Sharing

## Goal

Add the manual Browser page, side browser in Chat/Editor, isolated automation browser path for QA, and explicit artifact sharing into chats and threads.

## Why Fifth

The browser is valuable, but it should come after the core planning, execution, and review loop is already working.

Artifact sharing is the bridge that makes browser and manual debugging useful without violating privacy boundaries.

## Scope

- Browser top pill page
- side browser in Chat and Editor
- persistent manual browser profile
- isolated automation browser model for thread QA
- browser actions such as `Open Current App in Browser`
- artifact sharing controls
- destination picker behavior
- `Share All`
- combined browser plus runtime context share

## Deliverables

- dedicated Browser page
- resizable side browser
- persistent manual browser session
- isolated automation browser sessions for QA runs
- share browser/page/log/network data into chats and threads
- share terminal/debug output into chats and threads
- combined `Share All Context` flow

## Out of Scope

- advanced browser extension compatibility
- password manager integrations
- deeply complex browser profile management

## Technical Decisions To Respect

- manual browser and automation browser are separate systems
- agents never access the manual browser directly
- artifact sharing is explicit and user-mediated
- split view defaults to the current visible context

## Exit Criteria

- user can browse manually inside Ultra
- user can open a side browser from Chat or Editor
- user can share browser and runtime artifacts into a chosen chat or thread
- thread QA can attach browser automation artifacts without touching the manual browser

## Main Risks

- browser embedding ergonomics
- privacy boundary leaks between manual and automation browser contexts
- oversized artifacts flooding chat/thread context
