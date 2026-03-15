# Ultra File Attachments

## Status

Draft v0.1

This document defines user-provided file attachments for chat surfaces in Ultra.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Ultra should let users provide files directly to chats so the active model/runtime can inspect, parse, and reason about them.

This is an input convenience and context-ingestion feature.

## Core UX

Users should be able to:

- drag and drop one or more files into a chat input
- click an attach button and pick one or more files
- see attached files in the draft area before send
- remove files from the draft before send

The same reusable attachment input works in:

- main chat input
- thread coordinator chat input

## Scope

File attachments are transient context inputs.

They do not need long-term durable storage in v1.

Ultra only needs to retain them long enough for:

- the selected model/runtime to consume them
- the current interaction to reference them
- optional short-lived follow-up parsing within the same context

## Product Rules

- file attachments are user-initiated
- attachments are visible in the draft before send
- one or more files may be attached at once
- attachments may be combined with typed text and voice-input text
- attachments are not intended to become a long-term document store

## Retention Model

For v1, attachments should be ephemeral.

Recommended behavior:

- stage uploaded files in a temporary local area
- pass references into the chat/runtime context
- remove staged files after a bounded retention window or after the context no longer needs them

Ultra may still retain lightweight metadata in transcript messages, such as:

- filename
- size
- mime type
- local staged reference ID

## Supported Input Modes

- drag and drop
- file picker

## Suggested Attachment Metadata

- `attachment_id`
- `chat_id` or `thread_id`
- `original_filename`
- `mime_type`
- `size_bytes`
- `staged_path`
- `created_at`
- `expires_at`

## Product Boundary

This feature is for user-supplied files.

It is not the same as:

- browser artifact sharing
- generated thread artifacts
- repo file references already available through checkout context

## Locked Decisions

1. Chat file upload is supported
2. Multi-file upload is supported
3. Attachments are ephemeral, not long-term stored
4. Main chat and thread chat should be able to reuse the same attachment input pattern
5. Staged attachments expire `24 hours` after creation or immediately after successful send and backend parsing when no follow-up processing requires them
6. The limit is `25 MB` per file and `100 MB` total per draft
7. Attachments render in the draft and transcript as compact file chips showing filename, size, and upload state
