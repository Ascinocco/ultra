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
]
