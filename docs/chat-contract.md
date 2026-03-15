# Ultra Chat Contract

## Status

Draft v0.1

This document defines the behavior, scope, and UX contract of project chats in Ultra.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)

## Purpose

Chats are the primary planning and operator interface in Ultra.

A chat is not just a place to ask questions. It is the place where the user:

- pulls in task context
- researches and plans work
- reviews plans and specs
- starts autonomous execution
- performs direct CLI-style coding work when desired
- observes and references related threads

Chats are long-lived, project-scoped, and user-owned.

## Core Definition

A chat is a persistent project conversation backed by exactly one active model/runtime configuration at a time.

Each chat may:

- remain purely conversational
- perform direct coding work in a checkout
- spawn one or more execution threads over time
- reference other chats and threads in the same project

Thread ownership always remains explicit. Referencing a thread does not transfer ownership of that thread to another chat.

## Chat Responsibilities

Chats are responsible for:

- planning and problem framing
- ticket/context intake
- research and synthesis
- plan generation
- spec generation
- approvals for plan and spec transitions
- direct file edits and command execution when the model/runtime is permitted to do so
- creating threads after explicit user approval

Chats are not the primary surface for:

- thread review completion
- thread-specific approval queues
- raw process monitoring

Those belong primarily in thread UI.

## Chat Identity

Recommended fields:

- `chat_id`
- `project_id`
- `title`
- `status`
- `provider`
- `model`
- `thinking_level`
- `permission_level`
- `created_at`
- `updated_at`
- `pinned_at`
- `archived_at`
- `last_compacted_at`
- `current_session_id`

Recommended relationship fields:

- `referenced_chat_ids`
- `referenced_thread_ids`
- `spawned_thread_ids`

## Chat Lifecycle

Chats may be:

- `active`
- `archived`

Chats can be:

- renamed
- pinned
- unpinned
- archived
- restored

Multiple chats may be active concurrently in one project.

## Chat Runtime Configuration

Each chat has its own model/runtime configuration.

There is exactly one active configuration per chat at a time.

### User-Visible Controls

The chat input area should expose:

- provider
- model
- thinking level
- permission level
- voice input trigger
- file attachment trigger

### Configuration Rules

- one chat may be Claude while another is Codex
- users may change the active chat configuration over time
- the active chat configuration backs both normal conversation and direct coding behavior in that chat
- Ultra should not require the user to configure multiple internal model roles for one chat

### Thinking Level

Thinking level should use vendor-native labels and options where possible.

Ultra should not invent its own cross-provider reasoning enum if that would confuse users who already understand the vendor's terminology.

The UI may normalize presentation, but the visible choices should map closely to what the selected provider actually supports.

### Permission Level

Permission level is a user-facing safety mode for direct coding behavior.

v1 modes:

- `supervised`
- `full_access`

- `supervised`: the runtime may ask for confirmation before sensitive actions
- `full_access`: the runtime may perform edits and commands with minimal interruption

Ultra should let the underlying model/runtime's natural permission behavior apply where appropriate.

## Chat Context Model

Chats use rolling context, not infinite raw transcript replay.

### Always-Available Context

The only context that should be brought forward automatically every time is:

- compacted chat context
- the chat's own active thread references and thread state relevant to that chat

Ultra should not automatically inject:

- the full repo
- full thread logs
- all project chats
- all project tickets

### Runtime Context

Project runtime state should not be injected into every turn by default.

However, when the user asks the main chat to inspect or control runtime behavior, the backend should be able to retrieve and attach a focused runtime context bundle on demand.

That bundle may include:

- aggregate project runtime health
- coordinator status
- `ov watch` status
- watchdog status
- relevant degraded reasons

This keeps normal chat context lean while still enabling chat-driven runtime control.

### Compaction Behavior

When a chat grows too large:

- Ultra compacts the session into a continuation summary
- Ultra starts a new chat session with an optimized continuation prompt
- the new session picks up from the compacted state

What survives compaction:

- compacted working context
- linked threads
- chat configuration
- user-visible chat identity

What may be lost:

- low-value prior turn detail
- old conversational phrasing
- unused context that did not survive compaction

If the user needs lost detail, they can re-ask for it.

## Chat Execution Behavior

Chats may directly edit files and run commands without creating a thread.

This is intentional.

### Direct Coding Rules

- direct coding work happens in the active checkout
- the chat starts on the main checkout by default
- the chat may move to a branch or worktree if the user instructs it to
- the chat may open files, diffs, terminals, or editor targets as part of the workflow
- the user decides whether chat-local work stays chat-local or is promoted into a thread

### Promotion to Thread

Chat-local work may remain outside thread tracking.

If the user wants durable execution tracking, thread review, or coordinator-driven continuation, the user may promote that work into a thread.

Promotion should be explicit, not automatic.

## Direct Coding Checkpoints

Direct chat coding should create lightweight structured checkpoints.

### Checkpoint Granularity

Checkpoints should be milestone-level, not one record per low-level tool action.

Recommended checkpoint moments:

- meaningful file changes
- commands run
- branch creation or checkout changes
- worktree changes
- test/build result milestones
- explicit user-requested save points

### Checkpoint Storage

Checkpoints should exist in two forms:

- a readable representation in the chat transcript
- a structured machine-usable record in local persistence

### Checkpoint Payload

Recommended fields:

- `checkpoint_id`
- `chat_id`
- `session_id`
- `active_target_path`
- `branch_name`
- `worktree_path`
- `action_type`
- `affected_paths`
- `command_metadata`
- `result_summary`
- `artifact_refs`
- `created_at`

Do not store full file snapshots by default. Prefer structured metadata and references to artifacts or git state.

## Promotion Semantics

Promotion from chat-local work into a thread must be explicit.

The model may suggest promotion, but the user must confirm it.

### Promotion Payload

When chat-local work is promoted into a thread, Ultra should carry:

- promotion summary
- selected relevant chat messages
- structured chat coding checkpoints
- current checkout context
- linked artifact references
- spec references
- seed references used for downstream Overstory context

Do not blindly copy the full chat transcript into the thread context.

### Checkout Adoption Rule

If chat-local work is already happening in a dedicated branch or worktree, Ultra may adopt that checkout into the new thread.

If chat-local work is happening on the main checkout, Ultra should fork the work into a proper thread-owned worktree during promotion.

This keeps thread checkout ownership clean.

## Planning and Thread Creation Flow

The chat must explicitly ask the user to confirm starting work before creating a thread.

### Required Flow

1. user discusses a task in chat
2. chat proposes a plan
3. user approves the plan
4. chat proposes specs
5. user approves the specs
6. chat asks whether to start work
7. user confirms
8. Ultra creates a thread

### Product Rule

Plan approval and spec approval are distinct approvals and should happen one at a time.

Starting work must always require explicit user confirmation.

One chat may spawn many threads over time.

## Approval Model

Chats own approval for:

- plan approval
- spec approval

Chats do not need a separate Ultra-owned approval layer for normal code edits performed directly in chat.

For direct coding actions:

- the underlying runtime's normal behavior should apply
- if the runtime asks for confirmation, it asks
- if the runtime's configured permission mode allows the action, it proceeds

For destructive actions:

- the underlying runtime's normal safety behavior should still apply

Thread review approval remains primarily in thread UI.

## Thread Awareness

Chats should be aware of the threads they created or explicitly referenced.

Minimum thread awareness in chat:

- thread title
- thread state
- last activity
- readiness for review
- link to open thread

Chats may also reference threads created elsewhere in the same project when relevant.

This is useful for cross-thread awareness, but it does not change ownership boundaries.

## Main Chat and Coordinator Interaction

The main chat may interact with ongoing thread work at a high level.

Examples:

- asking for thread status
- referencing a related thread
- telling the system to open the thread in the editor
- steering what should happen next at a product level

Thread-specific execution discussion should still resolve into thread detail as the primary surface.

The chat can observe and orchestrate. The thread remains the execution home.

## Natural Language First

The chat experience should be primarily natural language driven.

Ultra should avoid turning the chat into a workflow form.

### Allowed Lightweight Assist

It is acceptable to provide suggestion chips or buttons when they reduce friction.

The clearest v1 example is:

- `Open in Editor`

This is a convenience action, not a replacement for natural language.

Ultra should infer planning/spec/start-work flow from the conversation rather than requiring a manual mode toggle such as `Plan` vs `Chat`.

## Voice Input

Chat inputs should support local speech-to-text as a draft-entry mechanism.

### Rules

- voice input inserts text into the current draft
- voice input does not auto-send by default
- voice input should be reusable across main chat and thread chat
- transcribed text persists like normal chat text once sent

## File Attachments

Chat inputs should support ephemeral user file attachments.

### Rules

- users can drag and drop files into the input
- users can attach one or more files through a picker
- attachments are visible in the draft before send
- attachments are ephemeral and not intended for long-term document storage
- attachment metadata may persist in normal transcript messages, but staged file contents do not need durable retention in v1

## Sidebar Contract

The chat sidebar should support:

- many chats per project
- pinning
- renaming
- archiving
- restoring archived chats

The sidebar is the project-level chat index, not the thread index.

## Data Model Additions

Recommended records:

- `chats`
- `chat_sessions`
- `chat_messages`
- `chat_compactions`
- `chat_thread_refs`
- `chat_chat_refs`

Recommended `chats` fields:

- `chat_id`
- `project_id`
- `title`
- `provider`
- `model`
- `thinking_level`
- `permission_level`
- `is_archived`
- `is_pinned`
- `created_at`
- `updated_at`

Recommended `chat_sessions` fields:

- `session_id`
- `chat_id`
- `sequence_number`
- `started_at`
- `ended_at`
- `compaction_source_session_id`
- `compaction_summary`
- `continuation_prompt`

## Locked Decisions

1. `thinking_level` uses the vendor's native visible options and labels rather than an Ultra-defined enum
2. Promotion from chat-local work into a thread produces one summarized promotion event in the thread timeline plus linked references to the carried messages, checkpoints, specs, seeds, and artifacts
3. Chat coding checkpoints are stored as structured records and appear in the transcript as compact activity entries
4. Thread references render inline in the chat transcript as clickable chips or cards that open the referenced thread detail
