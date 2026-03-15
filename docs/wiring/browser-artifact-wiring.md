# Ultra External Handoff and Artifact Wiring

## Scope

This document covers:

- external browser/editor/GitHub handoff
- runtime artifact capture
- artifact sharing into chats and threads

## Flow: Open External Browser

User action:

- click `Open in Browser`

IPC:

- `handoff.open_browser`

Backend:

- resolve the active project/worktree/thread context
- construct the target URL or local app URL
- invoke the system browser

DB:

- none required by default beyond reading current context

Store updates:

- optional handoff history update

## Flow: Open External Editor

User action:

- click `Open in Editor`

IPC:

- `handoff.open_editor`

Backend:

- resolve the active worktree path
- invoke the configured or default editor handoff

DB:

- none required by default beyond reading current context

Store updates:

- optional handoff history update

## Flow: Open GitHub Context

User action:

- click `Open in GitHub`

IPC:

- `handoff.open_github`

Backend:

- resolve branch, PR, or repository context from the active worktree or selected thread
- invoke the external Git hosting URL

DB:

- project/thread metadata tables as needed for branch or PR context

Store updates:

- optional handoff history update

## Flow: Capture Runtime Artifact

User action:

- click a runtime share action

IPC:

- `artifacts.capture_runtime`

Backend:

- collect terminal, runtime, or related debugging output
- normalize into an artifact bundle
- persist artifact metadata

DB:

- `artifacts`

Store updates:

- stage artifact for destination selection or immediate send

## Flow: Share To Chat

User action:

- confirm destination chat

IPC:

- `artifacts.share_to_chat`

Backend:

- create artifact share record
- attach structured artifact reference into chat context

DB:

- `artifact_shares`
- `artifacts`
- `chat_messages`

Store updates:

- append structured artifact attachment message to the destination chat

## Flow: Share To Thread

User action:

- confirm destination thread

IPC:

- `artifacts.share_to_thread`

Backend:

- create artifact share record
- attach artifact reference into thread context

DB:

- `artifact_shares`
- `artifacts`
- thread message/event storage as implemented

Store updates:

- append visible artifact attachment in the destination thread UI

## Flow: Share All Context

User action:

- click `Share All Context`

IPC:

- `artifacts.share_all_context`

Backend:

- capture runtime context
- capture terminal context
- build combined bundle
- route to selected destination

DB:

- `artifacts`
- `artifact_shares`
