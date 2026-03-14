# Ultra Thread Contract

## Status

Draft v0.1

This document defines the core execution object for Ultra after the product pivot to a chat-first command center with execution threads.

## Product Position

Ultra has two primary user-facing objects:

- `Chat`: a project-scoped planning and decision-making conversation that can also execute direct coding work when the user wants raw CLI-style interaction
- `Thread`: a project-scoped execution stream created from an approved plan/spec set

Users think in chats and threads, not in Overstory internals.

## Thread Definition

A thread is the persistent execution object created when a user approves turning planned work into executable specs and starts implementation.

A thread is the execution home for:

- spec set
- coordinator conversation
- worktree
- branch
- commit/publish policy
- review lifecycle
- agent activity
- logs and artifacts

Threads remain available after completion so the user can inspect history and continue talking to the coordinator.

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
- one worktree
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

- `ov_project_id`
- `ov_coordinator_id`
- `ov_thread_key`
- `external_ticket_refs`

Recommended execution fields:

- `spec_ids`
- `worktree_id`
- `worktree_path`
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
- `starting`: worktree, specs, coordinator, or watch processes are being prepared
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
- ensure a reviewable branch exists in a run worktree
- let the user open the worktree or branch in the editor page
- let the user run tests, inspect diffs, and ask for changes
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

## Review Checkout Model

When a thread reaches `awaiting_review`, the following should be true:

- a dedicated run worktree exists
- the worktree contains the implementation changes
- a branch exists for the thread
- the user can open that worktree directly in the editor page

Important git constraint:

- the same branch cannot normally be checked out in two linked worktrees at the same time

That means the primary review action should be:

- open the thread worktree in the editor page

If the user wants the branch in their main project checkout, Ultra should offer explicit actions such as:

- create a separate review worktree
- merge or cherry-pick the thread branch into the main checkout
- switch the main checkout only after the execution worktree releases the branch

Ultra should not assume the main checkout can directly switch to the same active branch while the run worktree still owns it.

## Thread UI Contract

### Thread List

The top-right pane is an infinitely scrollable list of thread cards.

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

Selecting a thread expands it into thread detail in the same pane.

### Thread Detail

Thread detail should have tabs:

- `Overview`
- `Timeline`
- `Agents`
- `Files`
- `Approvals`
- `Logs`

A persistent coordinator input sits at the bottom and remains available after completion.

### Default Detail Behavior

- `Overview` shows high-level progress, latest summary, linked specs, branch, PR, and current next action
- `Timeline` shows structured thread events in chronological order
- `Agents` shows coordinator and worker activity scoped only to the selected thread
- `Files` shows changed files, diffs, and worktree actions
- `Approvals` shows pending and completed approval actions
- `Logs` shows raw process output and diagnostics

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
- `thread.worktree_ready`
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

## Health Model

Thread health should expose a compact status for the project infrastructure required to keep work moving.

Tracked health objects:

- backend daemon
- project coordinator
- `ov watch`
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

## Open Decisions To Finalize

The following decisions are now fixed:

1. A thread keeps a stable identity even if the coordinator process restarts, and restart events appear in the timeline
2. `awaiting_review` requires a branch in a dedicated worktree with reviewable changes
3. A thread becomes `completed` after the user approves the work
4. Default publish flow is post-approval branch push plus draft PR creation
5. `changes_requested` returns the same thread to `running`
6. Thread detail is the primary review UI, but actions may also be triggered from the main chat

Remaining follow-up decisions:

1. Whether local auto-commit is mandatory before `awaiting_review` or whether staged/uncommitted work is allowed in special cases
2. Whether publish should always target a draft PR in v1 or allow direct branch push without PR
3. Whether direct code-editing actions from the main chat should create lightweight thread records automatically or remain chat-local until explicitly promoted
