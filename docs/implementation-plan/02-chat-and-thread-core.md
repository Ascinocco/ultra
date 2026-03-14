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
- chat can later do direct coding, but this milestone should first prove planning and thread creation cleanly
- thread snapshots and thread events are separate
- timeline is milestone-oriented, not raw-log-oriented

## Exit Criteria

- a user can create a chat, get to plan approval, get to spec approval, confirm start work, and see a new thread appear
- thread detail loads from persisted state and live events
- multiple chats can coexist without state corruption

## Main Risks

- blurring chat and thread responsibilities
- letting chat UX become a hidden form flow
- weak event streaming model causing thread UI instability
