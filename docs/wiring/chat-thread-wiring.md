# Ultra Chat and Thread Wiring

## Scope

This document covers:

- chat lifecycle
- chat messaging
- direct chat coding
- plan/spec approvals
- thread creation
- thread selection and updates

## Flow: Create Chat

User action:

- click `New Chat`

IPC:

- `chats.create`
- `chats.list`

Backend:

- create `chats` row
- create initial `chat_sessions` row

DB:

- `chats`
- `chat_sessions`

Store updates:

- append chat ID to `chatListsByProject`
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

DB:

- `chat_messages`
- `chat_sessions`

Store updates:

- append user and assistant message IDs to the active chat transcript

## Flow: Direct Chat Coding

User action:

- ask chat to make code changes or run commands

Frontend:

- no separate mode switch required

IPC:

- `chats.send_message`

Backend:

- resolve active checkout context
- route request through `ChatRuntimeAdapter`
- persist structured action/result messages
- create milestone checkpoints when applicable

DB:

- `chat_messages`
- `chat_action_checkpoints`

Store updates:

- append coding action/result messages to transcript

Important rule:

- no thread is created automatically

## Flow: Approve Plan

User action:

- approve the proposed plan block

IPC:

- `chats.approve_plan`

Backend:

- validate plan proposal exists and spec approval has not bypassed it
- persist approval message

DB:

- `chat_messages`

Store updates:

- mark plan proposal as approved in transcript UI

## Flow: Approve Specs

User action:

- approve the proposed spec block

IPC:

- `chats.approve_specs`

Backend:

- validate plan approval already exists
- persist spec approval message

DB:

- `chat_messages`

Store updates:

- mark spec proposal as approved in transcript UI

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
- publish thread update and thread event

DB:

- `threads`
- `chat_thread_refs`
- `thread_specs`
- `thread_ticket_refs`
- `thread_events`

Store updates:

- append thread to `threadListsByProject`
- append thread to `threadListsByChat`
- set or refresh `selectedThreadId`
- append initial thread event to `threadEventsByThread`

## Flow: Promote Chat Work To Thread

User action:

- explicitly promote chat-local coding work into a thread

IPC:

- `chats.promote_work_to_thread`

Backend:

- gather relevant chat context and attachments
- create thread snapshot
- append `thread.created`
- link source chat to thread
- attach selected checkpoints
- attach spec refs and seed refs

DB:

- `threads`
- `chat_thread_refs`
- `thread_events`
- `chat_action_checkpoints`

Store updates:

- same as normal thread creation

## Flow: Select Thread

User action:

- click a thread card

IPC:

- `threads.get`
- `threads.get_messages`
- `threads.get_events`
- `threads.get_agents`
- `threads.get_approvals`
- subscribe to `threads.messages`
- subscribe to `threads.events`

Backend:

- load thread snapshot and recent projections

DB:

- `threads`
- `thread_messages`
- `thread_events`
- `thread_agents`
- `approvals`

Store updates:

- set `selectedThreadId`
- hydrate thread detail slices

## Flow: Send Coordinator Message

User action:

- send a message from the thread coordinator input

IPC:

- `threads.send_message`

Backend:

- validate thread exists
- persist the user thread message
- forward message to the coordinator runtime
- persist assistant/coordinator replies as they arrive

DB:

- `thread_messages`

Store updates:

- append outbound and inbound messages under the selected thread

## Flow: Live Thread Update

Trigger:

- backend emits a thread update or event

IPC:

- `threads.updated`
- `threads.messages`
- `threads.events`

Backend:

- append event
- update thread projection

DB:

- `thread_messages`
- `thread_events`
- `threads`

Store updates:

- patch thread snapshot
- append any new thread messages
- append event by `thread_id`
- refresh visible thread card if needed
