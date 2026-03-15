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
]
