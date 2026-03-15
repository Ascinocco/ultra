# Milestone 2 Architecture: Chat and Thread Core

## Status

Draft v0.1

This document defines the architecture for Milestone 2 of Ultra: Chat and Thread Core.

Related docs:

- [implementation-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/implementation-plan.md)
- [02-chat-and-thread-core.md](/Users/tony/Projects/ultra/docs/implementation-plan/02-chat-and-thread-core.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [sqlite-schema.md](/Users/tony/Projects/ultra/docs/sqlite-schema.md)

## Purpose

Milestone 2 should make the core product real:

- many chats per project
- per-chat runtime config
- explicit plan/spec approvals
- explicit thread creation
- thread list and detail
- thread event streaming

This is the milestone where Ultra stops being an app shell and starts being a product.

## Architectural Goals

Milestone 2 should optimize for:

- clear boundary between chat and thread
- durable chat persistence
- durable thread snapshots and event history
- live UI updates without brittle nested state
- a natural-language-first UX with explicit approval transitions

It should not optimize for:

- runtime supervision depth
- real browser integration
- editor review completeness

## Core Boundary

The most important architecture rule in this milestone is:

- `Chat` is the planning and operator surface
- `Thread` is the execution object

Do not let one become an informal alias for the other.

### Chat Responsibilities

- transcript and session history
- model/runtime config
- plan generation
- spec generation
- plan/spec approval state
- direct user interaction
- direct coding in the active checkout
- thread creation requests

### Thread Responsibilities

- execution snapshot
- event history
- review state
- publish state
- coordinator conversation
- agent/activity/log surfaces

## Frontend Architecture

### Store Expansion

Milestone 1 introduced normalized store foundations.

Milestone 2 should add these slices:

- `chats`
- `chatMessages`
- `chatSessions`
- `threads`
- `threadLists`
- `threadEvents`
- `threadAgents`
- `threadApprovals`

Recommended normalized shape:

```ts
type AppState = {
  activeProjectId: string | null;
  activeChatId: string | null;
  selectedThreadId: string | null;
  chats: Record<string, ChatSnapshot>;
  chatListsByProject: Record<string, string[]>;
  chatMessagesByChat: Record<string, string[]>;
  chatSessionsByChat: Record<string, string[]>;
  threads: Record<string, ThreadSnapshot>;
  threadListsByProject: Record<string, string[]>;
  threadListsByChat: Record<string, string[]>;
  threadEventsByThread: Record<string, ThreadEvent[]>;
  threadAgentsByThread: Record<string, ThreadAgentSnapshot[]>;
  threadApprovalsByThread: Record<string, ApprovalSnapshot[]>;
};
```

### Why This Shape

- multiple chats can coexist
- thread detail can stay open while switching chats
- timeline replay is local to a thread
- thread status cards can update independently

### UI Composition

Recommended chat page composition for Milestone 2:

- `ChatPage`
- `ChatRail`
- `ActiveChatPane`
- `ThreadPane`
- `StatusPaneShell`

Recommended `ActiveChatPane` composition:

- `ChatHeader`
- `ChatTranscript`
- `PlanApprovalBlock`
- `SpecApprovalBlock`
- `ChatInputDock`
- `VoiceInputButton`

Recommended `ThreadPane` composition:

- `ThreadList`
- `ThreadCard`
- `ThreadDetail`
- `ThreadTabBar`
- `ThreadOverviewTab`
- `ThreadTimelineTab`
- `ThreadAgentsTab`
- `ThreadFilesTabShell`
- `ThreadApprovalsTab`
- `ThreadLogsTab`
- `CoordinatorInputDock`

The chat input dock and coordinator input dock should be able to share the same voice-input primitive.

## Chat Runtime Configuration Architecture

Each chat owns one active runtime config.

Recommended config object:

- `provider`
- `model`
- `thinking_level`
- `permission_level`

### Design Rule

Do not add internal sub-model roles in Milestone 2.

One chat, one active config, one conversation contract.

Thinking-level choices should map directly to what the selected vendor/runtime supports.

Permission level should remain a simple Ultra-owned two-mode enum:

- `supervised`
- `full_access`

## Direct Chat Coding Architecture

Milestone 2 should implement a minimal but real direct-coding path for chats.

### Rule

Direct coding remains chat-local unless the user explicitly promotes it into a thread.

### Required Behaviors

- chat runtime operates against the current active checkout context
- chat can produce file edits and command executions through the configured runtime
- chat-local coding history remains part of chat transcript state
- chat-local coding emits structured milestone checkpoints
- later promotion into a thread is an explicit backend operation

### Backend Boundary

Use one narrow service boundary for runtime-backed chat actions:

- `ChatRuntimeAdapter`

That adapter should expose structured action results back into the chat transcript rather than leaking raw provider-specific behavior into frontend state.

Recommended persistence:

- transcript-visible structured messages
- `chat_action_checkpoints` for machine-usable promotion history

## Chat Persistence Architecture

Chats need durable history and compaction-aware session tracking.

### Core Records

- `chats`
- `chat_sessions`
- `chat_messages`
- `chat_thread_refs`
- `chat_chat_refs`

### Service Layer

Recommended backend services:

- `ChatService`
- `ChatMessageService`
- `ChatSessionService`

Keep actual provider/runtime invocation behind one narrow boundary so Milestone 2 does not entangle persistence with model specifics.

Recommended boundary:

- `ChatRuntimeAdapter`

This can be stubbed or simplified at first, but the backend should not embed provider-specific logic directly inside `ChatService`.

## Approval Architecture

Plan and spec approvals in chat should be modeled explicitly, not inferred from raw message text alone.

### Recommended Message Model

`chat_messages` should support:

- plain conversational messages
- structured proposal messages
- structured approval messages

That means `message_type` should distinguish at least:

- `user_text`
- `assistant_text`
- `plan_proposal`
- `plan_approval`
- `spec_proposal`
- `spec_approval`
- `thread_start_request`

### Why

This gives the UI reliable structured states without forcing the whole interaction into forms.

## Thread Creation Architecture

Thread creation is the crossing point between chat and execution.

### Required Flow

1. chat contains a plan proposal
2. user approves plan
3. chat contains a spec proposal
4. user approves specs
5. user explicitly confirms start work
6. backend creates thread snapshot
7. backend appends `thread.created`

### Thread Creation Rule

Thread creation should be implemented as an explicit backend operation, not as an emergent side effect of a random chat message.

Recommended IPC command:

- `chats.start_thread`
- `chats.promote_work_to_thread`

### Data Written Atomically

When starting a thread, the backend should write in one transaction where practical:

- thread snapshot
- thread-chat reference
- initial thread event
- any initial spec/ticket link rows
- carried promotion metadata such as selected checkpoints, spec refs, and seed refs where applicable

## Thread Event Architecture

Milestone 2 should implement real thread events, not a placeholder timeline.

### Event Handling

- append event to `thread_events`
- update thread snapshot projection
- publish thread event to subscribers

### Projection Rule

Thread snapshots should always be derivable from event history plus runtime state assumptions later.

Even if runtime is still stubbed in Milestone 2, use the same architecture now.

## Backend Architecture

Milestone 2 backend should add these modules:

- `chats`
- `threads`
- `chat-runtime`
- `voice-input`
- `thread-projections`

Recommended services:

- `ChatService`
- `ChatMessageService`
- `ChatApprovalService`
- `VoiceInputService`
- `ThreadService`
- `ThreadEventService`
- `ThreadProjectionService`

Recommended repositories:

- `ChatRepository`
- `ChatMessageRepository`
- `ThreadRepository`
- `ThreadEventRepository`

## IPC Architecture For Milestone 2

Implement the next IPC slice for:

- `chats.list`
- `chats.create`
- `chats.rename`
- `chats.pin`
- `chats.archive`
- `chats.restore`
- `chats.get`
- `chats.get_messages`
- `chats.update_config`
- `chats.send_message`
- `chats.get_runtime_context`
- `chats.approve_plan`
- `chats.approve_specs`
- `chats.start_thread`
- `chats.promote_work_to_thread`
- `voice.start_capture`
- `voice.stop_capture`
- `voice.cancel_capture`
- `threads.list_by_project`
- `threads.list_by_chat`
- `threads.get`
- `threads.get_events`
- `threads.send_message`
- `threads.events`

### Subscription Model

Milestone 2 should implement real subscriptions for:

- chat messages
- thread updates
- thread events

### Replay Requirement

`threads.events` must support replay from `from_sequence`.

This is needed now because timeline correctness is part of the milestone.

## Persistence Architecture

Milestone 2 should implement these schema areas for real:

- `chats`
- `chat_sessions`
- `chat_messages`
- `chat_thread_refs`
- `chat_chat_refs`
- `threads`
- `thread_specs`
- `thread_ticket_refs`
- `thread_events`
- `thread_agents` as a thin stub/projection if helpful
- `approvals` if thread UI needs it now

Voice-entered messages should persist through normal `chat_messages` writes once submitted.

### Minimal Projection Fields

The `threads` snapshot table should be updated at least for:

- `execution_state`
- `review_state`
- `publish_state`
- `summary`
- `last_event_sequence`
- `last_activity_at`

Chat-side direct coding should not require a thread record unless explicitly promoted.

## Live Update Architecture

Thread cards and thread detail should be driven by the same underlying snapshot/event model.

### Rule

Do not maintain a separate ad hoc polling path for thread cards and a subscription path for thread detail.

Use one model:

- list queries for initial snapshots
- subscriptions for change propagation

## Placeholder Runtime Strategy

Milestone 2 needs thread creation without full runtime supervision yet.

Recommended approach:

- create threads as real objects
- allow simple placeholder state transitions
- allow stubbed or simplified coordinator message handling
- keep runtime complexity intentionally narrow until Milestone 4

### Why

This milestone should prove product flow, not real Overstory supervision depth.

## Error Handling Expectations

Milestone 2 should visibly handle:

- invalid approval order
- thread start without approved plan/specs
- subscription reconnect issues
- missing chat/thread records

The UI should reflect these as user-understandable issues rather than generic transport failures.

## Testing Strategy

Focus on contract correctness.

Recommended test areas:

- chat create/rename/pin/archive flows
- chat message persistence
- plan/spec approval sequencing
- thread creation transaction behavior
- thread event append plus projection update
- thread event replay from checkpoint
- multi-chat state isolation

## Main Architectural Risks

### 1. Chat/Thread Blurring

If the architecture lets threads become just “a mode of chat,” later review/runtime flows will get messy.

### 2. Weak Structured Message Types

If approvals are only implied by raw text, the UI will become fragile.

### 3. Split Read Models

If thread lists, thread detail, and coordinator chat all use different state paths, synchronization bugs will multiply.

## Locked Decisions For This Milestone

1. Chat and thread remain distinct objects
2. One chat can spawn many threads over time
3. Thread creation is an explicit backend operation
4. Plan/spec approvals are structured transitions
5. Thread timeline is driven by append-only events
6. Thread subscriptions are real in this milestone

## Open Follow-Ups

1. exact provider/runtime adapter design
2. whether coordinator thread chat messages should live in `chat_messages` or a dedicated thread-message store later
3. how much of `thread_agents` is worth implementing before Milestone 4
