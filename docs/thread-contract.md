# Ultra Thread Contract

## Status

Draft v0.1

This document defines the core execution object for Ultra after the product pivot to a chat-first command center with execution threads.

## Product Position

Ultra has two primary user-facing objects:

- `Chat`: a project-scoped planning and decision-making conversation that can also execute direct coding work when the user wants raw CLI-style interaction
- `Thread`: a project-scoped execution stream created from an approved plan/spec set

Users think in chats and threads, not in Ultra's orchestration layer.

## Thread Definition

A thread is the persistent execution object created when a user approves turning planned work into executable specs and starts implementation.

A thread is the execution home for:

- spec set
- coordinator conversation
- sandbox
- branch
- commit/publish policy
- review lifecycle
- agent activity
- logs and artifacts

Threads remain available after completion so the user can inspect history and continue talking to the coordinator.

In the user experience, a thread should feel like one durable execution conversation.
The user talks to the thread coordinator, not directly to raw sub-agents, Ultra's orchestration layer, or provider-specific agents.

## Thread Creation Rules

A thread is created only after all of the following are true:

- the work belongs to a specific project
- the work originated from a top-level chat
- the user approved the work breakdown into specs
- the user approved starting execution

Thread creation should feel conversational. The chat should naturally offer the next step:

1. plan the work
2. propose specs for review
3. ask whether to start work
4. create the thread once approved

## Thread Ownership

Each thread belongs to:

- exactly one project
- exactly one source chat
- exactly one primary coordinator context

Each thread may link to:

- one or more specs
- one or more external ticket references
- one primary sandbox
- one branch
- one draft PR

Each thread may contain many:

- agent/task records
- events
- logs
- approvals
- artifacts

## Thread Identity

Recommended thread identity fields:

- `thread_id`
- `project_id`
- `source_chat_id`
- `title`
- `summary`
- `created_at`
- `updated_at`
- `created_by_message_id`

Recommended external tracking fields:

- `ov_project_id` **(DEPRECATED — retained for migration only; use `project_id`)**
- `ov_coordinator_id` **(DEPRECATED — retained for migration only; use `coordinator_id`)**
- `ov_thread_key` **(DEPRECATED — retained for migration only; use `thread_id`)**
- `external_ticket_refs`

Recommended execution fields:

- `spec_ids`
- `sandbox_id`
- `sandbox_path`
- `branch_name`
- `base_branch`
- `commit_policy`
- `publish_policy`

Recommended review fields:

- `review_state`
- `last_review_requested_at`
- `approved_at`
- `completed_at`

Recommended health fields:

- `execution_state`
- `publish_state`
- `backend_health`
- `coordinator_health`
- `watch_health`
- `last_heartbeat_at`
- `restart_count`
- `failure_reason`

## Thread State Model

Use 3 parallel state axes instead of one overloaded status field.

### 1. Execution State

- `queued`
- `starting`
- `running`
- `blocked`
- `awaiting_review`
- `finishing`
- `completed`
- `failed`
- `canceled`

Definitions:

- `queued`: thread exists but coordinator work has not started yet
- `starting`: sandbox, specs, coordinator, or watch processes are being prepared
- `running`: coordinator is active and work is progressing
- `blocked`: execution cannot proceed without user input, dependency resolution, credentials, or a failed prerequisite
- `awaiting_review`: implementation work is ready for user testing and review
- `finishing`: finalization is in progress, such as commit, push, or PR creation
- `completed`: thread is complete from Ultra's perspective
- `failed`: execution failed and needs retry or intervention
- `canceled`: execution was canceled by the user or system

### 2. Review State

- `not_ready`
- `ready`
- `in_review`
- `changes_requested`
- `approved`

Definitions:

- `not_ready`: no user review should happen yet
- `ready`: thread has reached review readiness
- `in_review`: user is actively reviewing or testing
- `changes_requested`: user wants additional work on the same thread
- `approved`: user accepted the implementation for finalization

### 3. Publish State

- `not_requested`
- `ready_to_publish`
- `publishing`
- `published`
- `publish_failed`

Definitions:

- `not_requested`: no publish action has been requested
- `ready_to_publish`: thread is eligible to push branch and open PR
- `publishing`: publish workflow is running
- `published`: branch push and draft PR creation succeeded
- `publish_failed`: publish workflow failed and needs retry or intervention

## Recommended Thread Lifecycle

1. `queued / not_ready / not_requested`
2. `starting / not_ready / not_requested`
3. `running / not_ready / not_requested`
4. `awaiting_review / ready / ready_to_publish` or `awaiting_review / ready / not_requested`
5. `completed / approved / ready_to_publish` or `completed / approved / not_requested`
6. `completed / approved / publishing`
7. `completed / approved / published` or `completed / approved / publish_failed`

If the user requests changes after testing:

- `running / changes_requested / not_requested`

If execution or infrastructure fails:

- `failed / <last useful review state> / <last useful publish state>`

## Review and Completion Policy

Recommended default behavior:

- auto-commit locally when implementation reaches review readiness
- move thread to `awaiting_review`
- ensure a reviewable branch exists in a run sandbox
- let the user select that sandbox in Ultra
- let the user run tests from the terminal drawer and ask for changes
- after approval, mark the thread `completed`
- by default, then publish branch and open draft PR
- keep publish state separate from completion state

Configurable per project:

- branch naming template
- commit message template
- PR title/body template
- require approval before publish
- auto-publish after approval

Do not mark a thread `completed` before review is resolved. `awaiting_review` should be the practical end of autonomous execution. Completion happens after user approval, while publish remains a separate state axis.

## Review Sandbox Model

When a thread reaches `awaiting_review`, the following should be true:

- a dedicated run sandbox exists
- the sandbox contains the implementation changes
- a branch exists for the thread
- the user can select that sandbox directly in Ultra

Important git constraint:

- the same branch cannot normally be checked out in two linked worktrees at the same time

That means the primary review action should be:

- select the thread sandbox and open the integrated terminal in Ultra

If the user wants the branch in their main project checkout, Ultra should offer explicit actions such as:

- create a separate review sandbox
- merge or cherry-pick the thread branch into the main checkout
- switch the main checkout only after the execution sandbox releases the branch

Ultra should not assume the main checkout can directly switch to the same active branch while the run sandbox still owns it.

## Thread UI Contract

### Thread List

The top-right pane is a vertically scrollable list of collapsible thread cards.

Each card should show:

- title
- current execution state
- review state
- publish state
- linked ticket label
- current spec count
- branch name
- last activity time
- health indicator
- active sandbox label when available
- attention badge when user input or review is needed

Collapsed cards are status summaries only.
Selecting a thread expands it into thread detail in the same pane.
Only one thread should normally be expanded at a time in v1 so the right pane stays calm and easy to scan.

### Thread Detail

Thread detail should have these primary sections:

- header
- coordinator conversation
- timeline
- detail tabs
- coordinator input dock

The coordinator conversation is the main body of the thread.
It is the primary interaction surface for execution follow-up, clarification, and review feedback.

Thread detail should have these tabs:

- `Overview`
- `Timeline`
- `Agents`
- `Files`
- `Approvals`
- `Logs`

A persistent coordinator input sits at the bottom and remains available after completion.

### Default Detail Behavior

- `Overview` shows high-level progress, latest summary, linked specs, branch, PR, current next action, and current sandbox
- `Timeline` shows structured thread events in chronological order
- `Agents` shows coordinator and worker activity scoped only to the selected thread and should be treated as an advanced detail surface rather than the primary UX
- `Files` shows changed files, diffs, and sandbox actions
- `Approvals` shows pending and completed approval actions
- `Logs` shows raw process output and diagnostics

### Coordinator Conversation

The coordinator conversation is the thread's primary conversational surface.

It should display:

- coordinator status messages
- user replies
- blocking questions
- implementation summaries
- review-ready announcements
- explicit change-request follow-up

The coordinator conversation should not feel like a raw terminal transcript or a multi-agent swarm dashboard.
It should feel like one execution agent that owns the thread and can speak for the underlying execution system.

Provider implementation details such as `Codex` or `Claude` may be shown as lightweight diagnostics, but they should not replace the coordinator as the stable user-facing identity.

## Event Model

Thread detail should be driven by durable backend events, not reconstructed ad hoc from terminal text.

Minimum event types:

- `thread.created`
- `thread.title_updated`
- `thread.specs_attached`
- `thread.execution_state_changed`
- `thread.review_state_changed`
- `thread.publish_state_changed`
- `thread.health_changed`
- `thread.summary_updated`
- `thread.approval_requested`
- `thread.approval_resolved`
- `thread.sandbox_ready`
- `thread.branch_created`
- `thread.commit_created`
- `thread.pr_opened`
- `thread.agent_started`
- `thread.agent_updated`
- `thread.agent_finished`
- `thread.log_chunk`
- `thread.failed`
- `thread.completed`

Raw stdio may still be captured, but it should be a source for logs, not the primary domain model.

## Coordinator Interaction

Each thread has a coordinator chat channel separate from the top-level planning chat.

This coordinator chat is used for:

- asking for status
- clarifying implementation decisions
- requesting changes after review
- steering the ongoing thread without returning to planning chat

The coordinator chat should retain context for the life of the thread, including after completion.

Review and execution actions may also be initiated from the main chat, but thread-specific changes should resolve back into the thread as the primary control surface.

The user should never need to address raw swarm members directly in v1.
If Ultra's orchestration layer or another backend fans work out to multiple sub-agents, that detail should collapse back into:

- coordinator messages in the main thread conversation
- structured timeline events
- optional `Agents` detail when the user wants to inspect deeper execution activity

## Health Model

Thread health should expose a compact status for the project infrastructure required to keep work moving.

Tracked health objects:

- backend daemon
- project coordinator
- orchestration watcher
- optional helper watchdog process

Health statuses:

- `healthy`
- `degraded`
- `down`

Health records should include:

- `status`
- `checked_at`
- `last_heartbeat_at`
- `restart_count`
- `reason`

## Locked Decisions

1. A thread keeps a stable identity even if the coordinator process restarts, and restart events appear in the timeline
2. `awaiting_review` requires a branch in a dedicated sandbox with reviewable changes
3. A thread becomes `completed` after the user approves the work
4. Default publish flow is post-approval branch push plus draft PR creation
5. `changes_requested` returns the same thread to `running`
6. Thread detail is the primary review UI, but actions may also be triggered from the main chat
7. Local auto-commit is mandatory before `awaiting_review`
8. Publish targets a draft PR in v1 when publish is requested
9. Direct code-editing actions from the main chat remain chat-local until explicitly promoted into a thread
10. The thread coordinator is the only primary conversational surface for execution; swarm and worker details stay secondary
