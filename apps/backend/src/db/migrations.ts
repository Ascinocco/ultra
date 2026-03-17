export type DatabaseMigration = {
  id: string
  sql: string
}

export const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    id: "0001_initial_foundations",
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        git_root_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_last_opened_at
        ON projects(last_opened_at);

      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY,
        default_branch_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_layout_state (
        project_id TEXT PRIMARY KEY,
        current_page TEXT NOT NULL CHECK (current_page IN ('chat', 'editor', 'browser')),
        right_top_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (right_top_collapsed IN (0, 1)),
        right_bottom_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (right_bottom_collapsed IN (0, 1)),
        active_chat_id TEXT,
        selected_thread_id TEXT,
        last_editor_target_id TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: "0002_add_layout_pane_tabs",
    sql: `
      ALTER TABLE project_layout_state ADD COLUMN selected_right_pane_tab TEXT;
      ALTER TABLE project_layout_state ADD COLUMN selected_bottom_pane_tab TEXT;
    `,
  },
  {
    id: "0003_chat_persistence",
    sql: `
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        thinking_level TEXT NOT NULL,
        permission_level TEXT NOT NULL CHECK (permission_level IN ('supervised', 'full_access')),
        is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
        pinned_at TEXT,
        archived_at TEXT,
        last_compacted_at TEXT,
        current_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chats_project_updated
        ON chats(project_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_chats_project_status
        ON chats(project_id, status);

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        compaction_source_session_id TEXT,
        compaction_summary TEXT,
        continuation_prompt TEXT,
        UNIQUE (chat_id, sequence_number),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (compaction_source_session_id) REFERENCES chat_sessions(id)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        message_type TEXT NOT NULL,
        content_markdown TEXT,
        structured_payload_json TEXT,
        provider_message_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created
        ON chat_messages(chat_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
        ON chat_messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS chat_thread_refs (
        chat_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (chat_id, thread_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chat_chat_refs (
        source_chat_id TEXT NOT NULL,
        target_chat_id TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (source_chat_id, target_chat_id),
        FOREIGN KEY (source_chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (target_chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chat_action_checkpoints (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        active_target_path TEXT,
        branch_name TEXT,
        worktree_path TEXT,
        action_type TEXT NOT NULL,
        affected_paths_json TEXT NOT NULL,
        command_metadata_json TEXT,
        result_summary TEXT,
        artifact_refs_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_action_checkpoints_chat_created
        ON chat_action_checkpoints(chat_id, created_at);
    `,
  },
  {
    id: "0004_runtime_registry",
    sql: `
      CREATE TABLE IF NOT EXISTS project_runtimes (
        project_runtime_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        coordinator_id TEXT,
        coordinator_instance_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        last_heartbeat_at TEXT,
        restart_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_project_runtimes_project
        ON project_runtimes(project_id);

      CREATE TABLE IF NOT EXISTS runtime_components (
        component_id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        component_type TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
        process_id INTEGER,
        status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
        started_at TEXT,
        last_heartbeat_at TEXT,
        restart_count INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_components_project_type
        ON runtime_components(project_id, component_type);

      CREATE INDEX IF NOT EXISTS idx_runtime_components_scope_status
        ON runtime_components(scope, status);

      CREATE TABLE IF NOT EXISTS runtime_health_checks (
        health_check_id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL REFERENCES runtime_components(component_id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
        checked_at TEXT NOT NULL,
        last_heartbeat_at TEXT,
        reason TEXT,
        details_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_health_checks_component_checked
        ON runtime_health_checks(component_id, checked_at DESC);
    `,
  },
  {
    id: "0005_thread_core",
    sql: `
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_chat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        execution_state TEXT NOT NULL,
        review_state TEXT NOT NULL,
        publish_state TEXT NOT NULL,
        backend_health TEXT NOT NULL DEFAULT 'healthy',
        coordinator_health TEXT NOT NULL DEFAULT 'healthy',
        watch_health TEXT NOT NULL DEFAULT 'healthy',
        ov_project_id TEXT,
        ov_coordinator_id TEXT,
        ov_thread_key TEXT,
        worktree_id TEXT,
        branch_name TEXT,
        base_branch TEXT,
        latest_commit_sha TEXT,
        pr_provider TEXT,
        pr_number TEXT,
        pr_url TEXT,
        last_event_sequence INTEGER NOT NULL DEFAULT 0,
        restart_count INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT,
        created_by_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT,
        approved_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (source_chat_id) REFERENCES chats(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_threads_project_activity
        ON threads(project_id, last_activity_at DESC);

      CREATE INDEX IF NOT EXISTS idx_threads_chat_activity
        ON threads(source_chat_id, last_activity_at DESC);

      CREATE INDEX IF NOT EXISTS idx_threads_project_execution_state
        ON threads(project_id, execution_state);

      -- Recreate chat_thread_refs with FK to threads.
      -- Original from 0003 had no thread FK since threads table didn't exist.
      -- Must purge orphaned rows before recreation since FKs are enforced in production.
      ALTER TABLE chat_thread_refs RENAME TO chat_thread_refs_old;

      CREATE TABLE IF NOT EXISTS chat_thread_refs (
        chat_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (chat_id, thread_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      INSERT INTO chat_thread_refs
        SELECT * FROM chat_thread_refs_old
        WHERE thread_id IN (SELECT id FROM threads);

      DROP TABLE chat_thread_refs_old;

      CREATE TABLE IF NOT EXISTS thread_specs (
        thread_id TEXT NOT NULL,
        spec_path TEXT NOT NULL,
        spec_slug TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, spec_path),
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_ticket_refs (
        thread_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        display_label TEXT NOT NULL,
        url TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, provider, external_id),
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        message_type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        artifact_refs_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_created
        ON thread_messages(thread_id, created_at);
    `,
  },
  {
    id: "0006_sandbox_context_and_runtime_sync",
    sql: `
      CREATE TABLE IF NOT EXISTS sandbox_contexts (
        sandbox_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        path TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        sandbox_type TEXT NOT NULL CHECK (sandbox_type IN ('main_checkout', 'thread_sandbox')),
        branch_name TEXT,
        base_branch TEXT,
        is_main_checkout INTEGER NOT NULL DEFAULT 0 CHECK (is_main_checkout IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sandbox_contexts_project_used
        ON sandbox_contexts(project_id, last_used_at DESC);

      CREATE INDEX IF NOT EXISTS idx_sandbox_contexts_project_type
        ON sandbox_contexts(project_id, sandbox_type);

      CREATE TABLE IF NOT EXISTS project_runtime_profiles (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        runtime_file_paths_json TEXT NOT NULL DEFAULT '[".env"]',
        env_vars_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sandbox_runtime_syncs (
        sync_id TEXT PRIMARY KEY,
        sandbox_id TEXT NOT NULL REFERENCES sandbox_contexts(sandbox_id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        sync_mode TEXT NOT NULL DEFAULT 'managed_copy' CHECK (sync_mode IN ('managed_copy')),
        status TEXT NOT NULL CHECK (status IN ('unknown', 'synced', 'stale', 'failed')),
        synced_files_json TEXT NOT NULL,
        last_synced_at TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sandbox_runtime_syncs_sandbox
        ON sandbox_runtime_syncs(sandbox_id);

      ALTER TABLE project_layout_state
        ADD COLUMN last_active_sandbox_id TEXT REFERENCES sandbox_contexts(sandbox_id) ON DELETE SET NULL;

      INSERT INTO sandbox_contexts (
        sandbox_id,
        project_id,
        thread_id,
        path,
        display_name,
        sandbox_type,
        branch_name,
        base_branch,
        is_main_checkout,
        created_at,
        updated_at,
        last_used_at
      )
      SELECT
        'sandbox_' || lower(hex(randomblob(16))),
        projects.id,
        NULL,
        projects.root_path,
        'Main',
        'main_checkout',
        NULL,
        NULL,
        1,
        projects.created_at,
        projects.updated_at,
        projects.last_opened_at
      FROM projects
      WHERE NOT EXISTS (
        SELECT 1
        FROM sandbox_contexts
        WHERE sandbox_contexts.project_id = projects.id
          AND sandbox_contexts.is_main_checkout = 1
      );

      INSERT INTO project_runtime_profiles (
        project_id,
        runtime_file_paths_json,
        env_vars_json,
        created_at,
        updated_at
      )
      SELECT
        projects.id,
        '[".env"]',
        '{}',
        projects.created_at,
        projects.updated_at
      FROM projects
      WHERE NOT EXISTS (
        SELECT 1
        FROM project_runtime_profiles
        WHERE project_runtime_profiles.project_id = projects.id
      );

      UPDATE project_layout_state
      SET last_active_sandbox_id = (
        SELECT sandbox_contexts.sandbox_id
        FROM sandbox_contexts
        WHERE sandbox_contexts.project_id = project_layout_state.project_id
          AND sandbox_contexts.is_main_checkout = 1
        ORDER BY sandbox_contexts.created_at ASC
        LIMIT 1
      )
      WHERE last_active_sandbox_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM sandbox_contexts
          WHERE sandbox_contexts.project_id = project_layout_state.project_id
            AND sandbox_contexts.is_main_checkout = 1
        );
    `,
  },
  {
    id: "0007_thread_events_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS thread_events (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        sequence_number INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        UNIQUE (thread_id, sequence_number)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_events_thread_sequence
        ON thread_events(thread_id, sequence_number);

      CREATE INDEX IF NOT EXISTS idx_thread_events_project_recorded
        ON thread_events(project_id, recorded_at);
    `,
  },
  {
    id: "0008_artifacts_and_sharing",
    sql: `
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        artifact_type TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_thread_created
        ON artifacts(thread_id, created_at);

      CREATE TABLE IF NOT EXISTS artifact_shares (
        share_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        destination_type TEXT NOT NULL,
        destination_id TEXT NOT NULL,
        shared_by TEXT,
        shared_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artifact_shares_destination
        ON artifact_shares(destination_type, destination_id, shared_at DESC);
    `,
  },
  {
    id: "0009_layout_sidebar_and_split_ratio",
    sql: `
      ALTER TABLE project_layout_state
        ADD COLUMN sidebar_collapsed INTEGER NOT NULL DEFAULT 0
        CHECK (sidebar_collapsed IN (0, 1));

      ALTER TABLE project_layout_state
        ADD COLUMN chat_thread_split_ratio REAL NOT NULL DEFAULT 0.55;
    `,
  },
  {
    id: "0010_thread_agents_events_and_approvals",
    sql: `
      CREATE TABLE IF NOT EXISTS thread_event_logs (
        log_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES thread_events(event_id) ON DELETE SET NULL,
        agent_id TEXT,
        agent_type TEXT,
        stream TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_thread_event_logs_thread_created
        ON thread_event_logs(thread_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_thread_event_logs_thread_agent
        ON thread_event_logs(thread_id, agent_id, chunk_index);

      CREATE TABLE IF NOT EXISTS thread_agents (
        agent_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        parent_agent_id TEXT REFERENCES thread_agents(agent_id) ON DELETE SET NULL,
        agent_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        work_item_ref TEXT,
        started_at TEXT,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_thread_agents_thread_status
        ON thread_agents(thread_id, status);

      CREATE TABLE IF NOT EXISTS thread_file_changes (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        old_path TEXT,
        additions INTEGER,
        deletions INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_file_changes_thread
        ON thread_file_changes(thread_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        approval_type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        payload_json TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_thread_status
        ON approvals(thread_id, status);

      CREATE INDEX IF NOT EXISTS idx_approvals_project_status
        ON approvals(project_id, status);
    `,
  },
]
