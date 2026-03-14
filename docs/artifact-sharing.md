# Ultra Artifact Sharing

## Status

Draft v0.1

This document defines how users explicitly share browser and runtime artifacts into chats and threads.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)
- [browser-surface.md](/Users/tony/Projects/ultra/docs/browser-surface.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)

## Purpose

Ultra needs a safe way to let the user bring debugging context from Browser and Editor into chats and threads without giving agents direct access to the manual browser or arbitrary local process state.

The solution is user-mediated artifact sharing.

## Core Rule

Agents never directly access the manual browser session.

Agents only see browser and runtime data that the user explicitly shares into a chat or thread.

This same rule applies to terminal and debug output:

- no ambient agent access to arbitrary local sessions
- only explicit user sharing into a chosen context

## Artifact Sharing Model

Artifact sharing is a one-shot export of selected debugging context into a chat or thread.

Once shared, the artifact becomes part of that destination context and is available to the model/runtime backing that context.

### Destination Rule

- if shared to a chat, the active model/runtime for that chat receives it
- if shared to a thread, the coordinator context for that thread receives it

Ultra should not special-case Claude. Sharing is destination-driven, not provider-driven.

## Supported Artifact Types

### Browser Artifacts

- current URL
- page title
- visible page text
- screenshot
- selected DOM snapshot
- console logs
- network errors
- network request summary
- full captured page bundle metadata

### Editor / Runtime Artifacts

- terminal output
- debug console output
- test output
- build output
- process exit status
- process metadata such as command, cwd, and launch time

## Share Actions

Ultra should support explicit share actions from Browser and Editor surfaces.

### Browser Share Actions

- `Share Page`
- `Share Console Logs`
- `Share Network Data`
- `Share Screenshot`
- `Share Selected Element`
- `Share All`

### Editor Share Actions

- `Share Terminal Output`
- `Share Debug Output`
- `Share Test Output`
- `Share Build Output`
- `Share All`

## `Share All`

`Share All` is an important first-class action.

### Browser `Share All`

Should include:

- current URL
- page title
- screenshot
- console logs
- network data

### Editor `Share All`

Should include:

- active run/debug terminal output
- debug console output
- test/build output if present
- basic process metadata

### Combined Context Share

When both Browser and Editor surfaces are relevant, Ultra should support a combined `Share All Context` action that includes:

- browser logs
- browser network data
- active run/debug terminal output
- debug console output

This is especially useful during manual debugging and QA.

## Destination Selection

### Split View Behavior

When the browser is opened in split view from Chat or Thread context:

- sharing should default to the current visible context
- the destination should still be shown explicitly in the UI
- the user should be able to change the destination before sending

Examples:

- side browser opened from left chat defaults to that chat
- side browser opened from thread detail defaults to that thread

### Browser Page Behavior

When the user is on the top-level Browser page:

- there is no implicit destination
- share actions should open a destination picker

Recommended picker contents:

- recent chats in the current project
- recent threads in the current project
- last active destination

### Editor Page Behavior

Editor share actions should behave similarly:

- if opened from a thread review flow, default to that thread
- otherwise default to the active chat if there is one
- always show the destination before sending

## Destination UI

Share UI should make the destination obvious.

Recommended UI elements:

- destination chip in split view
- `Send to...` dropdown in Browser page
- `Send to...` dropdown in Editor page

The user should never wonder which model/context will receive the shared data.

## Data Packaging

Shared artifacts should be normalized before injection into chat or thread context.

### Packaging Goals

- concise enough to be useful
- structured enough to support downstream reasoning
- not so raw that the receiving context is flooded

### Recommended Envelope

Each shared artifact bundle should include:

- artifact type
- source surface
- capture time
- source metadata
- human-readable summary
- structured payload

## Suggested Artifact Bundle Shapes

### Browser Bundle

- `url`
- `title`
- `screenshot_path`
- `console_entries`
- `network_summary`
- `selected_dom_snippet`
- `captured_at`

### Runtime Bundle

- `process_type`
- `command`
- `cwd`
- `exit_code`
- `terminal_output`
- `debug_output`
- `captured_at`

### Combined Bundle

- browser bundle
- runtime bundle
- shared summary generated by Ultra before sending

## Capture Rules

### Browser Capture

Browser sharing should operate only on the manual browser state the user is currently viewing.

Ultra should not scrape background tabs or hidden browser state without explicit user action.

### Runtime Capture

Runtime sharing is most reliable for processes launched or mediated by Ultra through:

- run
- debug
- managed terminals
- test/build actions

Ultra should not promise clean capture for arbitrary pre-existing shell sessions it did not launch or observe.

## Privacy and Safety

- sharing is always user-initiated
- manual browser remains private unless the user shares from it
- shared artifacts become part of the selected chat or thread context
- destination should always be visible before send

## UX Recommendations

### Browser

- keep `Share All` prominent
- keep more granular share actions available in a menu
- show the destination chip in the browser toolbar

### Editor

- put share actions near the run/debug or terminal surfaces
- suggest `Share All Context` when a run/debug session fails

### Chat and Thread

- shared artifacts should appear as structured attachments in the transcript
- the receiving context should summarize what was shared before the model responds

## Product Consequences

This model solves the debugging use case cleanly:

- user manually debugs in Browser or Editor
- user shares artifacts into the relevant chat or thread
- the active model/runtime for that destination can analyze the data

This preserves privacy boundaries while still making the system practically useful.

## Data Model Direction

Likely records needed:

- `artifacts`
- `artifact_shares`

Suggested later `artifact_shares` fields:

- `share_id`
- `artifact_id`
- `destination_type`
- `destination_id`
- `shared_at`
- `shared_by`

## Locked Decisions

1. Artifact sharing is explicit and user-mediated
2. Agents never directly access the manual browser
3. The destination context determines which model/runtime receives the shared data
4. Split view defaults to the current visible context
5. Browser page uses an explicit destination picker
6. `Share All` is a first-class action
7. Combined browser plus runtime sharing is supported

## Open Follow-Ups

1. exact artifact bundle schemas
2. exact UI placement of share controls in Browser and Editor
3. retention policy for large shared logs and screenshots
4. whether Ultra should auto-summarize large bundles before attaching them
