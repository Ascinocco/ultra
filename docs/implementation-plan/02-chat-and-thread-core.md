# Milestone 2: Chat and Thread Core

## Goal

Make the Chat page real by implementing multi-chat workflow, chat messaging, plan/spec approval flow, thread creation, thread list/detail, and thread event streaming.

## Why Second

This milestone proves the core product thesis:

- chat-first workflow
- explicit plan/spec approvals
- threads as execution objects

If this milestone is weak, the product is weak.

## Scope

- chat sidebar
- active chat pane
- chat persistence
- chat runtime config controls
- direct chat coding in the active checkout
- reusable voice input in chat text boxes
- reusable file attachment input in chat text boxes
- plan approval block UI
- spec approval block UI
- explicit `start work` flow
- thread creation from chat
- thread list
- thread detail
- thread timeline wired to event stream
- coordinator message dock shell in thread detail

## Deliverables

- many chats per project
- pinned, renamed, archived chat behavior
- per-chat provider/model/thinking/perms config
- chat transcript persistence
- direct chat coding path in the active checkout
- voice-to-text insertion into chat drafts
- drag-and-drop and picker-based file attachment in chat drafts
- explicit plan approval interaction
- explicit spec approval interaction
- `start work` confirmation
- thread record creation
- thread detail UI with state badges and tabs
- thread event subscription and replay from checkpoint

## Out of Scope

- real autonomous implementation quality
- full runtime supervision hardening
- editor review loop
- browser QA

## Technical Decisions To Respect

- one active model/runtime config per chat
- chat supports direct coding in this milestone, but the scope stays narrow: active-checkout edits, commands, checkpoints, and explicit promotion
- thread snapshots and thread events are separate
- timeline is milestone-oriented, not raw-log-oriented

## Exit Criteria

- a user can create a chat, get to plan approval, get to spec approval, confirm start work, and see a new thread appear
- a user can use a chat for direct coding work in the active checkout without creating a thread
- a user can use voice input to populate a chat draft before sending
- a user can attach one or more files to a chat draft before sending
- thread detail loads from persisted state and live events
- multiple chats can coexist without state corruption

## Main Risks

- blurring chat and thread responsibilities
- letting chat UX become a hidden form flow
- weak event streaming model causing thread UI instability
