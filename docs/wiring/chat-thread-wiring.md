# Ultra Chat and Thread Wiring

## Scope

This document covers:

- chat lifecycle
- chat messaging
- direct chat coding
- plan and spec approvals
- thread creation
- thread selection and updates
- sandbox and terminal transitions that originate from thread UI

## Flow: Create Chat

User action:

- click `New Chat`

IPC:

- `chats.create`
- `chats.list`

Backend:

- create `chats` row
- create initial `chat_sessions` row

Store updates:

- append chat ID to the active project's chat list
- set `activeChatId`

## Flow: Send Chat Message

User action:

- submit text in chat input

IPC:

- `chats.send_message`
- subscribe or remain subscribed to `chats.messages`

Backend:

- persist user message
- invoke `ChatRuntimeAdapter`
- persist assistant response or structured proposal

Store updates:

- append user and assistant message IDs to the active chat transcript

## Flow: Direct Chat Coding

User action:

- ask chat to make code changes or run commands

IPC:

- `chats.send_message`

Backend:

- resolve active sandbox context
- route request through `ChatRuntimeAdapter`
- persist structured action and result messages
- create milestone checkpoints when applicable

Important rule:

- no thread is created automatically

## Flow: Start Thread

User action:

- confirm `Start work`

IPC:

- `chats.start_thread`

Backend:

- validate plan and spec approval sequence
- create thread snapshot
- create thread refs/spec refs/ticket refs
- append `thread.created`
- start coordinator-backed execution for that thread

Store updates:

- append thread to project and chat thread lists
- set or refresh `selectedThreadId`
- append initial thread event

## Flow: Select Thread Sandbox

User action:

- choose a thread sandbox from thread UI or the global sandbox selector

IPC:

- `sandboxes.set_active`

Backend:

- resolve the thread's concrete sandbox
- persist it as the active sandbox for the project
- refresh runtime sync status if needed

Store updates:

- set active sandbox
- keep selected thread
- refresh runtime sync state

## Flow: Open Terminal From Thread

User action:

- click `Open Terminal` from thread UI

IPC:

- `terminal.open`

Backend:

- resolve the selected thread sandbox
- ensure runtime files are synced if needed
- create or focus a terminal session in that sandbox

Store updates:

- open terminal drawer
- focus terminal session

## Flow: Request Changes

User action:

- click `Request Changes` from thread UI or chat review actions

IPC:

- `threads.request_changes`

Backend:

- validate reviewable thread state
- append review event
- move thread back toward active execution

Store updates:

- refresh thread snapshot
- append thread event

## Flow: Approve

User action:

- click `Approve`

IPC:

- `threads.approve`

Backend:

- validate reviewable thread state
- append approval event
- mark thread approved

Store updates:

- refresh thread snapshot
- append thread event

## Shell Composition Rule

The wiring model assumes:

- left sidebar = projects and chats
- center pane = active chat
- right pane = thread list and thread detail
- bottom drawer = terminal

Thread actions should enhance that shell, not open a separate execution page.
