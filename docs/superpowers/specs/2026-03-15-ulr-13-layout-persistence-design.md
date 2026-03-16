# ULR-13: Persist Per-Project Layout and Restore Cross-Page State

**Status:** Approved design
**Linear:** ULR-13
**Milestone:** M1 Foundations
**Blocked by:** ULR-11 (done), ULR-12 (done)
**Blocks:** ULR-49, ULR-14

## Objective

Make page mode, pane collapse state, and future page context persist per project. Reopening a project or restarting the app restores the user to exactly where they left off.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Persist trigger | Debounced (300ms) on every layout field change | Crash-resilient without IPC spam |
| Startup behavior | Auto-restore last active project + full layout | "Pick up where you left off" UX |
| Project switch | Fetch and apply full persisted layout immediately | Consistent with startup behavior |
| Update strategy | Optimistic fire-and-forget | Layout is local-only, no conflict risk; backend is just a persistence layer |
| Persist location | Store-level (inside Zustand action) | Single source of truth; components don't need to know about persistence |
| Missing DB columns | Add migration 0002 now | Spec says "save superset fields now even if some surfaces are placeholders" |

## Scope

### In scope

- Backend `getLayout()` and `setLayout()` on `ProjectService`
- Backend router handlers for `projects.get_layout` (query) and `projects.set_layout` (command)
- Migration `0002` adding `selected_right_pane_tab` and `selected_bottom_pane_tab` columns
- `supportsLayoutPersistence` capability flag set to `true`
- Frontend `setLayoutField()` store action with debounced persist
- Startup hydration: find last-opened project, fetch layout, apply
- Tests for all layers

### Out of scope

- Subscription event emission (`projects.layout_updated`) — contracts already exist in `packages/shared/src/contracts/projects.ts` (`projectsLayoutUpdatedEventSchema`, `projectsLayoutUpdatedEventPayload`) and `ipc.ts` (`subscriptionMethodSchema`), but backend emission and frontend subscription are deferred until multi-window sync is needed
- Layout versioning or migration of layout state shape
- Any UI changes to panes or tabs themselves

## Architecture

### Write Path (optimistic, debounced)

```
UI Action (click tab, collapse pane, switch page)
  → store.setLayoutField(projectId, { currentPage: "editor" })
    → Zustand merges partial into layout.byProjectId[projectId] (immediate)
    → Debounce timer resets (300ms)
      → ipcClient.command("projects.set_layout", { project_id, layout })
        → Preload → Main → BackendSocketClient → Unix socket
          → Backend router → ProjectService.setLayout() → UPSERT project_layout_state
```

The IPC call is fire-and-forget. The store does not await the response or roll back on failure.

### Read Path (startup & project switch)

```
App starts OR user opens a project
  → ipcClient.query("projects.get_layout", { project_id })
    → Backend reads project_layout_state → returns ProjectLayoutState
      → store.setLayoutForProject(projectId, layout)
        → UI renders with restored state
```

### Startup Sequence

```
1. Backend connects, capabilities hydrated
2. Renderer calls ipcClient.query("projects.list")
3. Find project with most recent lastOpenedAt → set as activeProjectId
4. Fetch its layout via projects.get_layout
5. Apply layout — user sees exactly where they left off
```

If no projects exist (fresh install), skip layout restoration and remain on default state.

## Backend Changes

### Migration `0002_add_layout_pane_tabs`

```sql
ALTER TABLE project_layout_state ADD COLUMN selected_right_pane_tab TEXT;
ALTER TABLE project_layout_state ADD COLUMN selected_bottom_pane_tab TEXT;
```

Two nullable TEXT columns added to match the full `ProjectLayoutState` contract.

### `ProjectService.getLayout(projectId: string): ProjectLayoutState`

- SELECT from `project_layout_state` WHERE `project_id = ?`
- If no row exists, return default layout:
  ```typescript
  {
    currentPage: "chat",
    rightTopCollapsed: false,
    selectedRightPaneTab: null,
    activeChatId: null,
    selectedThreadId: null,
    lastEditorTargetId: null,
    sidebarCollapsed: false,
    chatThreadSplitRatio: 0.55
  }
  ```
- **Note (2026-03-16):** `rightBottomCollapsed` and `selectedBottomPaneTab` have been removed from the layout state. The DB columns remain but are no longer read or written. Two new fields added: `sidebarCollapsed` (boolean) and `chatThreadSplitRatio` (number, default 0.55). See layout refinement spec for details.
- Map snake_case DB columns to camelCase DTO
- Convert SQLite integer columns (`right_top_collapsed`, `right_bottom_collapsed`) to booleans — SQLite returns `0`/`1`, not `true`/`false`

### `ProjectService.setLayout(projectId: string, layout: ProjectLayoutState): void`

- `INSERT OR REPLACE INTO project_layout_state` with columns: `project_id`, `current_page`, `right_top_collapsed`, `selected_right_pane_tab`, `active_chat_id`, `selected_thread_id`, `last_editor_target_id`, `sidebar_collapsed`, `chat_thread_split_ratio`, plus `updated_at`
- Convert boolean fields to integers for SQLite (`true` → `1`, `false` → `0`)
- Set `updated_at` to current ISO timestamp
- **Note (2026-03-16):** `right_bottom_collapsed` and `selected_bottom_pane_tab` columns are no longer written. Two new columns added via migration: `sidebar_collapsed INTEGER DEFAULT 0` and `chat_thread_split_ratio REAL DEFAULT 0.55`.

### Router additions (`router.ts`)

- `"projects.get_layout"` → validate with `projectsGetLayoutInputSchema` from `@ultra/shared`, call `projectService.getLayout()`
- `"projects.set_layout"` → validate with `projectsSetLayoutInputSchema` from `@ultra/shared`, call `projectService.setLayout()`

### Capability flag (`system-service.ts`)

- Set `supportsLayoutPersistence: true` in `BackendCapabilities`
- This flag must only be set to `true` in the same change that wires the router handlers — the frontend checks this flag before calling `projects.get_layout`, so a partial deployment (flag true, handlers missing) would cause errors

## Frontend Changes

### New store action: `setLayoutField(projectId, partial)`

```typescript
setLayoutField(projectId: string, partial: Partial<ProjectLayoutState>): void
```

- Merges `partial` into `layout.byProjectId[projectId]`, creating a default layout entry if absent
- After merging, triggers a per-project debounced persist (300ms). The debounce uses a `Map<string, NodeJS.Timeout>` keyed by project ID, so rapid changes to different projects don't cancel each other's pending writes. On fire:
  ```typescript
  ipcClient.command("projects.set_layout", {
    project_id: projectId,
    layout: get().layout.byProjectId[projectId]
  })
  ```
- Existing `setLayoutForProject()` remains unchanged — used for full hydration from backend

### Startup hydration

After backend connection is established and `projects.list` returns:

1. Find the project with the most recent `lastOpenedAt`
2. Set `activeProjectId` in the store
3. Call `ipcClient.query("projects.get_layout", { project_id })`
4. Call `store.setLayoutForProject(projectId, layout)` with the result
5. The `currentPage` from the restored layout drives which page renders

### Component integration

Existing components that change layout state will call `setLayoutField()` instead of directly setting individual fields. Known call sites:

- **Page navigation pills** (`AppShell` or equivalent) — `setLayoutField(projectId, { currentPage: "editor" })` on pill click
- **Pane collapse toggles** — `setLayoutField(projectId, { rightTopCollapsed: true })` on collapse/expand

This is the only change needed at the component level. Future components (tab selectors, chat/thread navigators) will follow the same pattern.

## Shared Contracts

No changes needed. The following types in `packages/shared/src/contracts/layout.ts` already cover the full scope:

- `ProjectLayoutState`
- `ProjectsGetLayoutInput`
- `ProjectsSetLayoutInput`
- `QueryMethodName` includes `"projects.get_layout"`
- `CommandMethodName` includes `"projects.set_layout"`

## Testing

### Backend unit tests (`project-service.test.ts`)

- `getLayout()` returns default layout when no row exists
- `getLayout()` returns persisted layout after `setLayout()`
- `setLayout()` upserts — second call overwrites first
- `setLayout()` with nullable fields stores and retrieves nulls correctly
- `getLayout()` converts SQLite integers (0/1) to booleans for collapse fields

### Backend router tests (`router.test.ts`)

- `projects.get_layout` routes correctly, validates `project_id` required
- `projects.set_layout` routes correctly, validates payload shape
- Returns error for non-existent project ID

### Frontend store tests

- `setLayoutField()` merges partial into existing layout
- `setLayoutField()` creates default layout if project has no entry
- `setLayoutForProject()` replaces full layout (hydration path)
- Debounce fires IPC after 300ms, coalesces rapid updates
- Per-project debounce: changes to project A don't cancel pending writes for project B

### Integration test

- Startup hydration: mock backend returning projects + layout, verify store is populated and correct page renders

### Migration test

- `0002` migration runs cleanly on a fresh DB (after `0001`)
- `0002` migration adds columns to existing `project_layout_state` table with null defaults

## File Manifest

| File | Change |
|------|--------|
| `apps/backend/src/db/migrations.ts` | Add `0002_add_layout_pane_tabs` migration |
| `apps/backend/src/projects/project-service.ts` | Add `getLayout()`, `setLayout()` methods |
| `apps/backend/src/ipc/router.ts` | Add `projects.get_layout`, `projects.set_layout` cases |
| `apps/backend/src/system/system-service.ts` | Set `supportsLayoutPersistence: true` |
| `apps/desktop/src/renderer/src/state/app-store.tsx` | Add `setLayoutField()` action with debounced persist |
| `apps/desktop/src/renderer/src/state/app-store.test.tsx` | Add layout persistence tests |
| `apps/backend/src/projects/project-service.test.ts` | Add getLayout/setLayout tests |
| `apps/backend/src/ipc/router.test.ts` | Add layout route tests |
