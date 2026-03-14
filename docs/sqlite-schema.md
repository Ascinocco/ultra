# Ultra SQLite Schema

## Status

Draft v0.1

This document defines the initial SQLite persistence model for Ultra.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [thread-event-schema.md](/Users/tony/Projects/ultra/docs/thread-event-schema.md)
- [editor-checkout-model.md](/Users/tony/Projects/ultra/docs/editor-checkout-model.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Ultra needs a local database that is:

- simple enough for fast iteration
- structured enough to support normalized frontend state
- durable enough for recovery and history
- opinionated about core ownership boundaries

SQLite is the source of truth for Ultra-local state.

SQLite is not the source of truth for:

- the git repository itself
- worktree file contents
- external provider state
- user-managed CLI configuration

## Core Rules

- use SQLite as the local application database
- use text IDs for all primary keys
- store timestamps in ISO 8601 UTC text format
- use foreign keys on core ownership boundaries
- use JSON columns for evolving payloads where strict relational modeling would slow iteration
- keep thread events append-only

## Storage Boundaries

### Repo-Owned Truth

Ultra should not treat the database as canonical for:

- source files
- branch contents
- worktree contents
- thread specs stored in the repo

### DB-Owned Truth

Ultra should treat the database as canonical for:

- chat identity and messages
- thread identity and snapshots
- thread event history
- runtime health records
- editor target state
- layout state
- approvals
- local artifact metadata

## ID Strategy

Use string IDs for all entities.

Recommended style:

- ULID-like or UUID-like opaque text IDs

Examples:

- `proj_...`
- `chat_...`
- `thread_...`
- `evt_...`
- `rt_...`

The exact encoding can be decided in implementation. The schema should only assume stable unique text IDs.

## Timestamp Strategy

Recommended timestamp columns:

- `created_at`
- `updated_at`
- domain-specific timestamps such as `approved_at`, `completed_at`, `last_heartbeat_at`

All timestamps should be UTC text for portability and debuggability in SQLite.

## Table Groups

The initial schema should be grouped into:

- projects
- chats
- chat sessions and references
- threads
- thread events and logs
- thread agents and approvals
- editor targets and runtime file sync
- runtime supervision
- browser
- artifacts
- layout and schema migration metadata

## Projects

### `projects`

One row per local project known to Ultra.

Columns:

- `project_id` TEXT PRIMARY KEY
- `project_key` TEXT NOT NULL UNIQUE
- `display_name` TEXT NOT NULL
- `root_path` TEXT NOT NULL
- `git_root_path` TEXT
- `default_branch` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- `last_opened_at` TEXT

Notes:

- `project_key` should be the git root absolute path when available
- fallback should be the opened folder absolute path

### `project_settings`

Project-level product configuration.

Columns:

- `project_id` TEXT PRIMARY KEY REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `auto_publish_after_approval` INTEGER NOT NULL DEFAULT 0
- `branch_name_template` TEXT
- `commit_message_template` TEXT
- `pr_title_template` TEXT
- `pr_body_template` TEXT
- `runtime_file_paths_json` TEXT NOT NULL DEFAULT '[".env"]'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

## Chats

### `chats`

One row per project chat.

Columns:

- `chat_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `title` TEXT NOT NULL
- `status` TEXT NOT NULL DEFAULT 'active'
- `provider` TEXT NOT NULL
- `model` TEXT NOT NULL
- `thinking_level` TEXT NOT NULL
- `permission_level` TEXT NOT NULL
- `is_pinned` INTEGER NOT NULL DEFAULT 0
- `pinned_at` TEXT
- `archived_at` TEXT
- `last_compacted_at` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Indexes:

- `idx_chats_project_updated` on (`project_id`, `updated_at` DESC)
- `idx_chats_project_status` on (`project_id`, `status`)

### `chat_sessions`

Tracks compaction boundaries and rolling context sessions per chat.

Columns:

- `session_id` TEXT PRIMARY KEY
- `chat_id` TEXT NOT NULL REFERENCES `chats`(`chat_id`) ON DELETE CASCADE
- `sequence_number` INTEGER NOT NULL
- `started_at` TEXT NOT NULL
- `ended_at` TEXT
- `compaction_source_session_id` TEXT REFERENCES `chat_sessions`(`session_id`)
- `compaction_summary` TEXT
- `continuation_prompt` TEXT

Constraint:

- UNIQUE (`chat_id`, `sequence_number`)

### `chat_messages`

Persistent chat transcript messages.

Columns:

- `message_id` TEXT PRIMARY KEY
- `chat_id` TEXT NOT NULL REFERENCES `chats`(`chat_id`) ON DELETE CASCADE
- `session_id` TEXT NOT NULL REFERENCES `chat_sessions`(`session_id`) ON DELETE CASCADE
- `role` TEXT NOT NULL
- `message_type` TEXT NOT NULL
- `content_markdown` TEXT
- `structured_payload_json` TEXT
- `provider_message_id` TEXT
- `created_at` TEXT NOT NULL

Indexes:

- `idx_chat_messages_chat_created` on (`chat_id`, `created_at`)
- `idx_chat_messages_session_created` on (`session_id`, `created_at`)

### `chat_thread_refs`

Links chats to relevant threads.

Columns:

- `chat_id` TEXT NOT NULL REFERENCES `chats`(`chat_id`) ON DELETE CASCADE
- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `reference_type` TEXT NOT NULL
- `created_at` TEXT NOT NULL

Primary key:

- (`chat_id`, `thread_id`)

### `chat_chat_refs`

Cross-chat references inside one project.

Columns:

- `source_chat_id` TEXT NOT NULL REFERENCES `chats`(`chat_id`) ON DELETE CASCADE
- `target_chat_id` TEXT NOT NULL REFERENCES `chats`(`chat_id`) ON DELETE CASCADE
- `created_at` TEXT NOT NULL

Primary key:

- (`source_chat_id`, `target_chat_id`)

## Threads

### `threads`

Current snapshot for each execution thread.

Columns:

- `thread_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `source_chat_id` TEXT NOT NULL REFERENCES `chats`(`chat_id`) ON DELETE RESTRICT
- `title` TEXT NOT NULL
- `summary` TEXT
- `execution_state` TEXT NOT NULL
- `review_state` TEXT NOT NULL
- `publish_state` TEXT NOT NULL
- `backend_health` TEXT NOT NULL DEFAULT 'healthy'
- `coordinator_health` TEXT NOT NULL DEFAULT 'healthy'
- `watch_health` TEXT NOT NULL DEFAULT 'healthy'
- `ov_project_id` TEXT
- `ov_coordinator_id` TEXT
- `ov_thread_key` TEXT
- `worktree_id` TEXT REFERENCES `editor_targets`(`target_id`) ON DELETE SET NULL
- `branch_name` TEXT
- `base_branch` TEXT
- `latest_commit_sha` TEXT
- `pr_provider` TEXT
- `pr_number` TEXT
- `pr_url` TEXT
- `last_event_sequence` INTEGER NOT NULL DEFAULT 0
- `restart_count` INTEGER NOT NULL DEFAULT 0
- `failure_reason` TEXT
- `created_by_message_id` TEXT REFERENCES `chat_messages`(`message_id`) ON DELETE SET NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- `last_activity_at` TEXT
- `approved_at` TEXT
- `completed_at` TEXT

Indexes:

- `idx_threads_project_activity` on (`project_id`, `last_activity_at` DESC)
- `idx_threads_chat_activity` on (`source_chat_id`, `last_activity_at` DESC)
- `idx_threads_project_execution_state` on (`project_id`, `execution_state`)

### `thread_specs`

Links threads to repo-backed specs.

Columns:

- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `spec_path` TEXT NOT NULL
- `spec_slug` TEXT NOT NULL
- `created_at` TEXT NOT NULL

Primary key:

- (`thread_id`, `spec_path`)

### `thread_ticket_refs`

Links threads to external ticket metadata captured locally.

Columns:

- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `provider` TEXT NOT NULL
- `external_id` TEXT NOT NULL
- `display_label` TEXT NOT NULL
- `url` TEXT
- `metadata_json` TEXT
- `created_at` TEXT NOT NULL

Primary key:

- (`thread_id`, `provider`, `external_id`)

## Thread Events and Logs

### `thread_events`

Append-only milestone event stream per thread.

Columns:

- `event_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `sequence_number` INTEGER NOT NULL
- `event_type` TEXT NOT NULL
- `actor_type` TEXT NOT NULL
- `actor_id` TEXT
- `source` TEXT NOT NULL
- `payload_json` TEXT NOT NULL
- `occurred_at` TEXT NOT NULL
- `recorded_at` TEXT NOT NULL

Constraints:

- UNIQUE (`thread_id`, `sequence_number`)

Indexes:

- `idx_thread_events_thread_sequence` on (`thread_id`, `sequence_number`)
- `idx_thread_events_project_recorded` on (`project_id`, `recorded_at`)

### `thread_event_logs`

Large raw log chunks associated with thread or agent execution.

Columns:

- `log_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `event_id` TEXT REFERENCES `thread_events`(`event_id`) ON DELETE SET NULL
- `agent_id` TEXT
- `agent_type` TEXT
- `stream` TEXT NOT NULL
- `chunk_index` INTEGER NOT NULL
- `chunk_text` TEXT NOT NULL
- `created_at` TEXT NOT NULL

Indexes:

- `idx_thread_event_logs_thread_created` on (`thread_id`, `created_at`)
- `idx_thread_event_logs_thread_agent` on (`thread_id`, `agent_id`, `chunk_index`)

Notes:

- this table is eligible for rotation or compaction later
- structured milestone events should remain durable even if raw logs are pruned

## Thread Agents and Approvals

### `thread_agents`

Current snapshot for coordinator and worker entities associated with a thread.

Columns:

- `agent_id` TEXT PRIMARY KEY
- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `parent_agent_id` TEXT REFERENCES `thread_agents`(`agent_id`) ON DELETE SET NULL
- `agent_type` TEXT NOT NULL
- `display_name` TEXT NOT NULL
- `status` TEXT NOT NULL
- `summary` TEXT
- `work_item_ref` TEXT
- `started_at` TEXT
- `updated_at` TEXT NOT NULL
- `finished_at` TEXT

Indexes:

- `idx_thread_agents_thread_status` on (`thread_id`, `status`)

### `thread_file_changes`

Cached changed-file summary for thread review and file surfaces.

Columns:

- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `path` TEXT NOT NULL
- `change_type` TEXT NOT NULL
- `old_path` TEXT
- `additions` INTEGER
- `deletions` INTEGER
- `updated_at` TEXT NOT NULL

Primary key:

- (`thread_id`, `path`)

Indexes:

- `idx_thread_file_changes_thread` on (`thread_id`, `updated_at` DESC)

### `approvals`

Thread-specific approval records.

Columns:

- `approval_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `approval_type` TEXT NOT NULL
- `status` TEXT NOT NULL
- `title` TEXT NOT NULL
- `description` TEXT
- `payload_json` TEXT NOT NULL
- `requested_at` TEXT NOT NULL
- `resolved_at` TEXT
- `resolved_by` TEXT

Indexes:

- `idx_approvals_thread_status` on (`thread_id`, `status`)
- `idx_approvals_project_status` on (`project_id`, `status`)

## Editor Targets and Runtime Files

### `editor_targets`

Concrete checkout paths available in the editor page.

Columns:

- `target_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `thread_id` TEXT REFERENCES `threads`(`thread_id`) ON DELETE SET NULL
- `path` TEXT NOT NULL UNIQUE
- `display_name` TEXT NOT NULL
- `target_type` TEXT NOT NULL
- `branch_name` TEXT
- `base_branch` TEXT
- `is_main_checkout` INTEGER NOT NULL DEFAULT 0
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- `last_used_at` TEXT

Indexes:

- `idx_editor_targets_project_used` on (`project_id`, `last_used_at` DESC)
- `idx_editor_targets_project_type` on (`project_id`, `target_type`)

### `project_runtime_profiles`

Project-scoped runtime file and env behavior for editor targets.

Columns:

- `project_id` TEXT PRIMARY KEY REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `runtime_file_paths_json` TEXT NOT NULL DEFAULT '[".env"]'
- `env_vars_json` TEXT NOT NULL DEFAULT '{}'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### `target_runtime_syncs`

Tracks runtime file sync state per target.

Columns:

- `sync_id` TEXT PRIMARY KEY
- `target_id` TEXT NOT NULL REFERENCES `editor_targets`(`target_id`) ON DELETE CASCADE
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `sync_mode` TEXT NOT NULL DEFAULT 'managed_copy'
- `status` TEXT NOT NULL
- `synced_files_json` TEXT NOT NULL
- `last_synced_at` TEXT
- `details_json` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Indexes:

- `idx_target_runtime_syncs_target` on (`target_id`)

## Runtime Supervision

### `project_runtimes`

Current runtime snapshot per project.

Columns:

- `project_runtime_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL UNIQUE REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `coordinator_id` TEXT
- `coordinator_instance_id` TEXT
- `status` TEXT NOT NULL
- `started_at` TEXT
- `last_heartbeat_at` TEXT
- `restart_count` INTEGER NOT NULL DEFAULT 0
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### `runtime_components`

Current status of backend-supervised runtime components.

Columns:

- `component_id` TEXT PRIMARY KEY
- `project_id` TEXT REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `component_type` TEXT NOT NULL
- `scope` TEXT NOT NULL
- `process_id` INTEGER
- `status` TEXT NOT NULL
- `started_at` TEXT
- `last_heartbeat_at` TEXT
- `restart_count` INTEGER NOT NULL DEFAULT 0
- `reason` TEXT
- `details_json` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Indexes:

- `idx_runtime_components_project_type` on (`project_id`, `component_type`)
- `idx_runtime_components_scope_status` on (`scope`, `status`)

Notes:

- `project_id` may be NULL for global components such as `ov watch`

## Browser

### `browser_profiles`

Persistent manual browser profile records.

Columns:

- `profile_id` TEXT PRIMARY KEY
- `scope` TEXT NOT NULL
- `display_name` TEXT NOT NULL
- `storage_path` TEXT NOT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### `browser_bookmarks`

Manual browser bookmarks.

Columns:

- `bookmark_id` TEXT PRIMARY KEY
- `profile_id` TEXT NOT NULL REFERENCES `browser_profiles`(`profile_id`) ON DELETE CASCADE
- `title` TEXT NOT NULL
- `url` TEXT NOT NULL
- `position` INTEGER
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Indexes:

- `idx_browser_bookmarks_profile_position` on (`profile_id`, `position`)

### `browser_sessions`

Tracked manual or automation browser sessions.

Columns:

- `browser_session_id` TEXT PRIMARY KEY
- `profile_id` TEXT REFERENCES `browser_profiles`(`profile_id`) ON DELETE SET NULL
- `thread_id` TEXT REFERENCES `threads`(`thread_id`) ON DELETE SET NULL
- `session_type` TEXT NOT NULL
- `status` TEXT NOT NULL
- `started_at` TEXT NOT NULL
- `ended_at` TEXT
- `metadata_json` TEXT

Indexes:

- `idx_browser_sessions_thread` on (`thread_id`, `started_at` DESC)

### `runtime_health_checks`

Time-series health checks and watchdog observations.

Columns:

- `health_check_id` TEXT PRIMARY KEY
- `component_id` TEXT NOT NULL REFERENCES `runtime_components`(`component_id`) ON DELETE CASCADE
- `project_id` TEXT REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `status` TEXT NOT NULL
- `checked_at` TEXT NOT NULL
- `last_heartbeat_at` TEXT
- `reason` TEXT
- `details_json` TEXT

Indexes:

- `idx_runtime_health_checks_component_checked` on (`component_id`, `checked_at` DESC)

## Artifacts

### `artifacts`

Metadata for thread-generated artifacts.

Columns:

- `artifact_id` TEXT PRIMARY KEY
- `project_id` TEXT NOT NULL REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `thread_id` TEXT NOT NULL REFERENCES `threads`(`thread_id`) ON DELETE CASCADE
- `artifact_type` TEXT NOT NULL
- `title` TEXT NOT NULL
- `path` TEXT
- `metadata_json` TEXT NOT NULL
- `created_at` TEXT NOT NULL

Indexes:

- `idx_artifacts_thread_created` on (`thread_id`, `created_at`)

### `artifact_shares`

Tracks explicit user-mediated sharing of artifacts into chats or threads.

Columns:

- `share_id` TEXT PRIMARY KEY
- `artifact_id` TEXT NOT NULL REFERENCES `artifacts`(`artifact_id`) ON DELETE CASCADE
- `destination_type` TEXT NOT NULL
- `destination_id` TEXT NOT NULL
- `shared_by` TEXT
- `shared_at` TEXT NOT NULL

Indexes:

- `idx_artifact_shares_destination` on (`destination_type`, `destination_id`, `shared_at` DESC)

## Layout and App Metadata

### `project_layout_state`

Persistent layout state for the command-center and editor pages.

Columns:

- `project_id` TEXT PRIMARY KEY REFERENCES `projects`(`project_id`) ON DELETE CASCADE
- `active_chat_id` TEXT REFERENCES `chats`(`chat_id`) ON DELETE SET NULL
- `selected_thread_id` TEXT REFERENCES `threads`(`thread_id`) ON DELETE SET NULL
- `last_editor_target_id` TEXT REFERENCES `editor_targets`(`target_id`) ON DELETE SET NULL
- `right_top_collapsed` INTEGER NOT NULL DEFAULT 0
- `right_bottom_collapsed` INTEGER NOT NULL DEFAULT 0
- `selected_right_pane_tab` TEXT
- `selected_bottom_pane_tab` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### `schema_migrations`

Tracks applied database migrations.

Columns:

- `migration_id` TEXT PRIMARY KEY
- `applied_at` TEXT NOT NULL

## Suggested DDL Notes

Recommended SQLite pragmas:

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`

Recommended implementation notes:

- use explicit transactions for thread snapshot plus event append updates
- keep event append and snapshot update atomic where possible
- avoid storing huge raw logs inline with core thread snapshots

## Snapshot Projection Rules

Some tables are primary records, while others are projections updated from events and runtime state.

### Primary Write Tables

- `projects`
- `project_settings`
- `chats`
- `chat_sessions`
- `chat_messages`
- `threads`
- `thread_events`
- `thread_event_logs`
- `runtime_components`
- `runtime_health_checks`

### Projection-Like Tables

- `thread_agents`
- `project_runtimes`
- `target_runtime_syncs`
- `project_layout_state`

The backend may rebuild some projections from durable history if needed.

## Minimal v1 Schema

If implementation needs a narrower first slice, these tables are the true minimum:

- `projects`
- `project_settings`
- `chats`
- `chat_sessions`
- `chat_messages`
- `threads`
- `thread_events`
- `editor_targets`
- `project_runtime_profiles`
- `runtime_components`
- `project_layout_state`
- `schema_migrations`

## Locked Decisions

1. SQLite is the source of truth for Ultra-local state
2. Thread snapshots and thread events are stored separately
3. Raw log chunks are stored separately from milestone events
4. Editor targets are first-class DB objects
5. Runtime supervision state is first-class DB state
6. Layout state is persisted per project
7. JSON columns are acceptable for evolving payloads in v1

## Open Follow-Ups

1. exact DDL and indexes for implementation
2. whether some JSON columns should later be normalized further
3. retention policy for `thread_event_logs` and `runtime_health_checks`
4. whether thread publish metadata should be split into a dedicated table later
