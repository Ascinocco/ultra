# Ultra File Attachment Wiring

## Scope

This document covers:

- drag-and-drop file staging
- picker-based file staging
- draft attachment lifecycle
- sending attached files with chat/thread messages

## Flow: Stage Files

User action:

- drag and drop files into a supported input
- or pick files from an attachment button

IPC:

- `attachments.stage_files`

Backend:

- copy or stage files into a temporary local area
- return staged attachment metadata

Store updates:

- add staged attachments to the active draft

UI updates:

- show attachment chips or rows in the draft area

## Flow: Remove Staged File

User action:

- remove one staged attachment from the draft

IPC:

- `attachments.remove_staged_file`

Backend:

- remove staged attachment reference
- clean up staged file if no longer needed

Store updates:

- remove attachment from draft state

## Flow: Clear Draft Attachments

User action:

- clear the draft or cancel attachment staging

IPC:

- `attachments.clear_staged_files`

Backend:

- clear staged references for that draft context

Store updates:

- reset draft attachment state

## Flow: Send Message With Attachments

User action:

- submit a chat or thread message with staged files attached

IPC:

- `chats.send_message` or `threads.send_message`

Backend:

- resolve staged attachment references
- pass attachment references into the runtime/model context
- persist normal message with attachment metadata

DB:

- `chat_messages` for main chat
- thread message storage as implemented for thread chat

Important rule:

- staged file contents do not need durable DB storage in v1
- attachment metadata may persist in the submitted message payload
