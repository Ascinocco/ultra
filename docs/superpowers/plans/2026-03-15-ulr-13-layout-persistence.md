# ULR-13: Layout Persistence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-project layout state to SQLite and restore it on app startup and project switch.

**Architecture:** Backend gets `getLayout()`/`setLayout()` on `ProjectService`, wired through the IPC router. Frontend gets a `setLayoutField()` store action with per-project debounced persist. ULR-70 already wired the read path in `openProjectFromPath` — this plan completes the backend handlers it calls and adds the write path.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, Zod, Zustand, Vitest

**Spec:** `docs/superpowers/specs/2026-03-15-ulr-13-layout-persistence-design.md`

---

## Chunk 1: Backend — Migration, Service, Router, Capability Flag

### Task 1: Add migration `0002_add_layout_pane_tabs`

**Files:**
- Modify: `apps/backend/src/db/migrations.ts:6-45`

- [ ] **Step 1: Write the migration**

Add a second migration entry to the `DATABASE_MIGRATIONS` array:

```typescript
{
  id: "0002_add_layout_pane_tabs",
  sql: `
    ALTER TABLE project_layout_state ADD COLUMN selected_right_pane_tab TEXT;
    ALTER TABLE project_layout_state ADD COLUMN selected_bottom_pane_tab TEXT;
  `,
},
```

Append this after the existing `0001_initial_foundations` entry (after line 44, before the closing `]`).

- [ ] **Step 2: Run backend tests to verify migration applies cleanly**

Run: `cd apps/backend && pnpm test`
Expected: All existing tests pass. The migration adds nullable columns — existing INSERT statements that omit them will default to NULL.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/migrations.ts
git commit -m "feat(backend): add migration 0002 for layout pane tab columns (ULR-13)"
```

---

### Task 2: Add `getLayout()` and `setLayout()` to `ProjectService`

**Files:**
- Modify: `apps/backend/src/projects/project-service.ts`
- Test: `apps/backend/src/projects/project-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/backend/src/projects/project-service.test.ts`, inside the existing `describe("ProjectService", ...)` block, after the last `it(...)`:

```typescript
it("getLayout returns default layout when no row exists", () => {
  const { directory, databasePath } = createWorkspace()
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const service = new ProjectService(runtime.database)

  const layout = service.getLayout("proj_nonexistent")

  expect(layout).toEqual({
    currentPage: "chat",
    rightTopCollapsed: false,
    rightBottomCollapsed: false,
    selectedRightPaneTab: null,
    selectedBottomPaneTab: null,
    activeChatId: null,
    selectedThreadId: null,
    lastEditorTargetId: null,
  })

  runtime.close()
})

it("setLayout persists and getLayout retrieves layout state", () => {
  const { directory, databasePath } = createWorkspace()
  const projectDir = join(directory, "my-project")
  mkdirSync(projectDir)
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const service = new ProjectService(
    runtime.database,
    () => "2026-03-15T12:00:00Z",
  )

  const project = service.open({ path: projectDir })
  service.setLayout(project.id, {
    currentPage: "editor",
    rightTopCollapsed: true,
    rightBottomCollapsed: false,
    selectedRightPaneTab: "files",
    selectedBottomPaneTab: null,
    activeChatId: "chat_abc",
    selectedThreadId: null,
    lastEditorTargetId: "target_xyz",
  })

  const layout = service.getLayout(project.id)

  expect(layout).toEqual({
    currentPage: "editor",
    rightTopCollapsed: true,
    rightBottomCollapsed: false,
    selectedRightPaneTab: "files",
    selectedBottomPaneTab: null,
    activeChatId: "chat_abc",
    selectedThreadId: null,
    lastEditorTargetId: "target_xyz",
  })

  runtime.close()
})

it("setLayout upserts — second call overwrites first", () => {
  const { directory, databasePath } = createWorkspace()
  const projectDir = join(directory, "upsert-project")
  mkdirSync(projectDir)
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const service = new ProjectService(
    runtime.database,
    () => "2026-03-15T12:00:00Z",
  )

  const project = service.open({ path: projectDir })

  service.setLayout(project.id, {
    currentPage: "chat",
    rightTopCollapsed: false,
    rightBottomCollapsed: false,
    selectedRightPaneTab: null,
    selectedBottomPaneTab: null,
    activeChatId: null,
    selectedThreadId: null,
    lastEditorTargetId: null,
  })

  service.setLayout(project.id, {
    currentPage: "browser",
    rightTopCollapsed: true,
    rightBottomCollapsed: true,
    selectedRightPaneTab: "timeline",
    selectedBottomPaneTab: "logs",
    activeChatId: "chat_123",
    selectedThreadId: "thread_456",
    lastEditorTargetId: "target_789",
  })

  const layout = service.getLayout(project.id)

  expect(layout.currentPage).toBe("browser")
  expect(layout.rightTopCollapsed).toBe(true)
  expect(layout.rightBottomCollapsed).toBe(true)
  expect(layout.selectedRightPaneTab).toBe("timeline")
  expect(layout.selectedBottomPaneTab).toBe("logs")
  expect(layout.activeChatId).toBe("chat_123")
  expect(layout.selectedThreadId).toBe("thread_456")
  expect(layout.lastEditorTargetId).toBe("target_789")

  runtime.close()
})

it("getLayout converts SQLite integers to booleans for collapse fields", () => {
  const { directory, databasePath } = createWorkspace()
  const projectDir = join(directory, "bool-project")
  mkdirSync(projectDir)
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const service = new ProjectService(
    runtime.database,
    () => "2026-03-15T12:00:00Z",
  )

  const project = service.open({ path: projectDir })

  // The default inserted by open() has integer 0 for both collapse fields
  const layout = service.getLayout(project.id)

  expect(layout.rightTopCollapsed).toBe(false)
  expect(layout.rightBottomCollapsed).toBe(false)
  expect(typeof layout.rightTopCollapsed).toBe("boolean")
  expect(typeof layout.rightBottomCollapsed).toBe("boolean")

  runtime.close()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && pnpm test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `service.getLayout is not a function`

- [ ] **Step 3: Write the implementation**

Add the following import at the top of `apps/backend/src/projects/project-service.ts` (line 6, alongside the existing `@ultra/shared` import):

```typescript
import type {
  ProjectId,
  ProjectLayoutState,
  ProjectOpenInput,
  ProjectSnapshot,
} from "@ultra/shared"
```

(Add `ProjectLayoutState` to the existing import.)

Then add these two methods to the `ProjectService` class, after the `list()` method (after line 248):

```typescript
getLayout(projectId: string): ProjectLayoutState {
  const row = this.database
    .prepare(
      `SELECT
        current_page,
        right_top_collapsed,
        right_bottom_collapsed,
        selected_right_pane_tab,
        selected_bottom_pane_tab,
        active_chat_id,
        selected_thread_id,
        last_editor_target_id
      FROM project_layout_state
      WHERE project_id = ?`,
    )
    .get(projectId) as
    | {
        current_page: string
        right_top_collapsed: number
        right_bottom_collapsed: number
        selected_right_pane_tab: string | null
        selected_bottom_pane_tab: string | null
        active_chat_id: string | null
        selected_thread_id: string | null
        last_editor_target_id: string | null
      }
    | undefined

  if (!row) {
    return {
      currentPage: "chat",
      rightTopCollapsed: false,
      rightBottomCollapsed: false,
      selectedRightPaneTab: null,
      selectedBottomPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
    }
  }

  return {
    currentPage: row.current_page as ProjectLayoutState["currentPage"],
    rightTopCollapsed: row.right_top_collapsed === 1,
    rightBottomCollapsed: row.right_bottom_collapsed === 1,
    selectedRightPaneTab: row.selected_right_pane_tab,
    selectedBottomPaneTab: row.selected_bottom_pane_tab,
    activeChatId: row.active_chat_id,
    selectedThreadId: row.selected_thread_id,
    lastEditorTargetId: row.last_editor_target_id,
  }
}

setLayout(projectId: string, layout: ProjectLayoutState): void {
  this.database
    .prepare(
      `INSERT OR REPLACE INTO project_layout_state (
        project_id,
        current_page,
        right_top_collapsed,
        right_bottom_collapsed,
        selected_right_pane_tab,
        selected_bottom_pane_tab,
        active_chat_id,
        selected_thread_id,
        last_editor_target_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      layout.currentPage,
      layout.rightTopCollapsed ? 1 : 0,
      layout.rightBottomCollapsed ? 1 : 0,
      layout.selectedRightPaneTab,
      layout.selectedBottomPaneTab,
      layout.activeChatId,
      layout.selectedThreadId,
      layout.lastEditorTargetId,
      this.now(),
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && pnpm test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests PASS including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/projects/project-service.ts apps/backend/src/projects/project-service.test.ts
git commit -m "feat(backend): add getLayout and setLayout to ProjectService (ULR-13)"
```

---

### Task 3: Wire router handlers for `projects.get_layout` and `projects.set_layout`

**Files:**
- Modify: `apps/backend/src/ipc/router.ts:1-200`

- [ ] **Step 1: Add imports**

Add `projectsGetLayoutInputSchema` and `projectsSetLayoutInputSchema` to the `@ultra/shared` import block at the top of `router.ts` (line 8-15):

```typescript
import {
  IPC_PROTOCOL_VERSION,
  parseIpcRequestEnvelope,
  parseProjectOpenInput,
  parseSystemHelloQuery,
  projectsGetInputSchema,
  projectsGetLayoutInputSchema,
  projectsSetLayoutInputSchema,
  projectsListQuerySchema,
  systemGetBackendInfoQuerySchema,
  systemPingQuerySchema,
} from "@ultra/shared"
```

- [ ] **Step 2: Add route cases**

In the `switch (request.name)` block, before the `default:` case (line 177), add:

```typescript
case "projects.get_layout": {
  const getLayoutQuery = assertQueryRequest(request)
  const { project_id } = projectsGetLayoutInputSchema.parse(
    getLayoutQuery.payload,
  )
  return createSuccessResponse(
    getLayoutQuery.request_id,
    services.projectService.getLayout(project_id),
  )
}
case "projects.set_layout": {
  const setLayoutCommand = assertCommandRequest(request)
  const { project_id, layout } = projectsSetLayoutInputSchema.parse(
    setLayoutCommand.payload,
  )
  services.projectService.setLayout(project_id, layout)
  return createSuccessResponse(setLayoutCommand.request_id, null)
}
```

- [ ] **Step 3: Write router handler tests**

There is no dedicated router test file yet. Add an integration-level test by adding layout route coverage to the existing project-service test file. Add to `apps/backend/src/projects/project-service.test.ts`, inside the existing `describe("ProjectService", ...)` block:

```typescript
it("setLayout rejects writes for non-existent project due to FK constraint", () => {
  const { databasePath } = createWorkspace()
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const service = new ProjectService(runtime.database)

  expect(() =>
    service.setLayout("proj_nonexistent", {
      currentPage: "chat",
      rightTopCollapsed: false,
      rightBottomCollapsed: false,
      selectedRightPaneTab: null,
      selectedBottomPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
    }),
  ).toThrow()

  runtime.close()
})
```

- [ ] **Step 4: Run backend tests**

Run: `cd apps/backend && pnpm test`
Expected: All tests PASS including the new FK constraint test.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ipc/router.ts apps/backend/src/projects/project-service.test.ts
git commit -m "feat(backend): wire projects.get_layout and projects.set_layout routes (ULR-13)"
```

---

### Task 4: Set `supportsLayoutPersistence` capability flag to `true`

**Files:**
- Modify: `apps/backend/src/system/system-service.ts:15-20`

- [ ] **Step 1: Flip the flag**

In `system-service.ts` line 17, change:

```typescript
supportsLayoutPersistence: false,
```

to:

```typescript
supportsLayoutPersistence: true,
```

- [ ] **Step 2: Run all backend tests**

Run: `cd apps/backend && pnpm test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/system/system-service.ts
git commit -m "feat(backend): enable supportsLayoutPersistence capability (ULR-13)"
```

---

## Chunk 2: Frontend — `setLayoutField` with Debounced Persist and Startup Hydration

### Task 5: Add `setLayoutField()` store action with per-project debounced persist

**Files:**
- Modify: `apps/desktop/src/renderer/src/state/app-store.tsx:1-225`
- Test: `apps/desktop/src/renderer/src/app-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these tests to `apps/desktop/src/renderer/src/app-shell.test.tsx`, inside the existing `describe("app store", ...)` block:

```typescript
it("setLayoutField merges partial into existing layout", () => {
  const store = createAppStore()
  const fullLayout: ProjectLayoutState = {
    currentPage: "chat",
    rightTopCollapsed: false,
    rightBottomCollapsed: false,
    selectedRightPaneTab: null,
    selectedBottomPaneTab: null,
    activeChatId: null,
    selectedThreadId: null,
    lastEditorTargetId: null,
  }

  store.getState().actions.setLayoutForProject("proj-1", fullLayout)
  store.getState().actions.setLayoutField("proj-1", { currentPage: "editor" })

  const result = store.getState().layout.byProjectId["proj-1"]
  expect(result.currentPage).toBe("editor")
  expect(result.rightTopCollapsed).toBe(false)
})

it("setLayoutField creates default layout if project has no entry", () => {
  const store = createAppStore()

  store
    .getState()
    .actions.setLayoutField("proj-new", { rightTopCollapsed: true })

  const result = store.getState().layout.byProjectId["proj-new"]
  expect(result.currentPage).toBe("chat")
  expect(result.rightTopCollapsed).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `setLayoutField is not a function`

- [ ] **Step 3: Write the implementation**

In `apps/desktop/src/renderer/src/state/app-store.tsx`:

**a)** Add `ipcClient` import after line 17:

```typescript
import { ipcClient } from "../ipc/ipc-client.js"
```

**b)** Add default layout constant and debounce infrastructure after `defaultLayoutState` (after line 83):

```typescript
const DEFAULT_LAYOUT: ProjectLayoutState = {
  currentPage: "chat",
  rightTopCollapsed: false,
  rightBottomCollapsed: false,
  selectedRightPaneTab: null,
  selectedBottomPaneTab: null,
  activeChatId: null,
  selectedThreadId: null,
  lastEditorTargetId: null,
}

const layoutPersistTimers = new Map<string, ReturnType<typeof setTimeout>>()

function debouncedPersistLayout(
  projectId: string,
  getState: () => AppStoreState,
): void {
  const existing = layoutPersistTimers.get(projectId)

  if (existing) {
    clearTimeout(existing)
  }

  layoutPersistTimers.set(
    projectId,
    setTimeout(() => {
      layoutPersistTimers.delete(projectId)
      const layout = getState().layout.byProjectId[projectId]

      if (layout) {
        ipcClient
          .command("projects.set_layout", {
            project_id: projectId,
            layout,
          })
          .catch(() => {
            // Fire-and-forget — layout persist failures are non-fatal.
          })
      }
    }, 300),
  )
}
```

**c)** Add `setLayoutField` to the `AppActions` type (after `setLayoutForProject` on line 54):

```typescript
setLayoutField: (
  projectId: string,
  partial: Partial<ProjectLayoutState>,
) => void
```

**d)** Add the no-op stub in `buildInitialState` actions (after `setLayoutForProject` on line 104):

```typescript
setLayoutField: () => undefined,
```

**e)** Update `createAppStore` to use `(set, get)` pattern. Change line 122 from:

```typescript
return createStore<AppStoreState>()((set) => ({
```

to:

```typescript
return createStore<AppStoreState>()((set, get) => ({
```

Then add the action implementation after `setLayoutForProject` (after line 190):

```typescript
setLayoutField: (projectId, partial) =>
  set((state) => {
    const current = state.layout.byProjectId[projectId] ?? DEFAULT_LAYOUT
    const merged = { ...current, ...partial }

    debouncedPersistLayout(projectId, get)

    return {
      ...state,
      layout: {
        byProjectId: {
          ...state.layout.byProjectId,
          [projectId]: merged,
        },
      },
    }
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests PASS including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/state/app-store.tsx apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "feat(frontend): add setLayoutField with per-project debounced persist (ULR-13)"
```

---

### Task 6: Add startup hydration — restore last active project and layout

**Files:**
- Modify: `apps/desktop/src/renderer/src/projects/project-workflows.ts`
- Test: `apps/desktop/src/renderer/src/projects/project-workflows.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/renderer/src/projects/project-workflows.test.ts`, inside the existing `describe("project workflows", ...)` block:

```typescript
it("hydrateLastProject restores the most recently opened project and its layout", async () => {
  const actions = makeActions()
  const recentProject = makeProject("proj-1", "Alpha")
  const olderProject = makeProject("proj-2", "Beta")
  const layout: ProjectLayoutState = {
    currentPage: "browser",
    rightTopCollapsed: true,
    rightBottomCollapsed: false,
    selectedRightPaneTab: null,
    selectedBottomPaneTab: null,
    activeChatId: "chat_1",
    selectedThreadId: null,
    lastEditorTargetId: null,
  }

  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({
        projects: [
          { ...recentProject, lastOpenedAt: "2026-03-15T12:00:00Z" },
          { ...olderProject, lastOpenedAt: "2026-03-14T12:00:00Z" },
        ],
      })
      .mockResolvedValueOnce(layout),
    command: vi.fn(),
  }

  const capabilities: BackendCapabilities = {
    supportsProjects: true,
    supportsLayoutPersistence: true,
    supportsSubscriptions: false,
    supportsBackendInfo: true,
  }

  await hydrateLastProject(actions, capabilities, client)

  expect(actions.setProjects).toHaveBeenCalled()
  expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
  expect(client.query).toHaveBeenNthCalledWith(2, "projects.get_layout", {
    project_id: "proj-1",
  })
  expect(actions.setLayoutForProject).toHaveBeenCalledWith("proj-1", layout)
  expect(actions.setCurrentPage).toHaveBeenCalledWith("browser")
})

it("hydrateLastProject is a no-op when no projects exist", async () => {
  const actions = makeActions()
  const client = {
    query: vi.fn().mockResolvedValueOnce({ projects: [] }),
    command: vi.fn(),
  }

  const capabilities: BackendCapabilities = {
    supportsProjects: true,
    supportsLayoutPersistence: true,
    supportsSubscriptions: false,
    supportsBackendInfo: true,
  }

  await hydrateLastProject(actions, capabilities, client)

  expect(actions.setProjects).toHaveBeenCalledWith([])
  expect(actions.setActiveProjectId).not.toHaveBeenCalled()
  expect(actions.setLayoutForProject).not.toHaveBeenCalled()
})

it("hydrateLastProject skips layout restore when capability is off", async () => {
  const actions = makeActions()
  const recentProject = makeProject("proj-1", "Alpha")
  const client = {
    query: vi.fn().mockResolvedValueOnce({
      projects: [
        { ...recentProject, lastOpenedAt: "2026-03-15T12:00:00Z" },
      ],
    }),
    command: vi.fn(),
  }

  const capabilities: BackendCapabilities = {
    supportsProjects: true,
    supportsLayoutPersistence: false,
    supportsSubscriptions: false,
    supportsBackendInfo: true,
  }

  await hydrateLastProject(actions, capabilities, client)

  expect(actions.setProjects).toHaveBeenCalled()
  expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
  expect(actions.setLayoutForProject).not.toHaveBeenCalled()
})
```

Also add `hydrateLastProject` to the import statement at the top of the test file (line 10):

```typescript
import {
  hydrateLastProject,
  loadRecentProjects,
  openProjectFromPath,
  openProjectFromPicker,
  type ProjectWorkflowActions,
} from "./project-workflows.js"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `hydrateLastProject is not a function` (or import error)

- [ ] **Step 3: Write the implementation**

Add to `apps/desktop/src/renderer/src/projects/project-workflows.ts`, after the `openProjectFromPicker` function (after line 112):

```typescript
export async function hydrateLastProject(
  actions: ProjectWorkflowActions,
  capabilities: BackendCapabilities | null,
  client: ProjectWorkflowClient = ipcClient,
): Promise<void> {
  const projects = await loadRecentProjects(actions, client)

  if (projects.length === 0) {
    return
  }

  // projects.list returns sorted by lastOpenedAt DESC
  const lastProject = projects[0]
  actions.setActiveProjectId(lastProject.id)

  if (capabilities?.supportsLayoutPersistence) {
    try {
      const layoutResult = await client.query("projects.get_layout", {
        project_id: lastProject.id,
      })
      const layout = parseProjectLayoutState(layoutResult)

      actions.setLayoutForProject(lastProject.id, layout)
      actions.setCurrentPage(layout.currentPage)
    } catch {
      // Layout restore is best-effort.
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests PASS including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/projects/project-workflows.ts apps/desktop/src/renderer/src/projects/project-workflows.test.ts
git commit -m "feat(frontend): add hydrateLastProject for startup layout restore (ULR-13)"
```

---

## Chunk 3: Cross-cutting — Typecheck, Build, Full Test Suite

### Task 7: Run full typecheck and test suite

**Files:** None (verification only)

- [ ] **Step 1: Build shared package**

Run: `cd packages/shared && pnpm build`
Expected: Clean build, no errors.

- [ ] **Step 2: Typecheck backend**

Run: `cd apps/backend && pnpm typecheck`
Expected: No type errors.

- [ ] **Step 3: Typecheck desktop**

Run: `cd apps/desktop && pnpm typecheck`
Expected: No type errors.

- [ ] **Step 4: Run all backend tests**

Run: `cd apps/backend && pnpm test`
Expected: All tests pass.

- [ ] **Step 5: Run all desktop tests**

Run: `cd apps/desktop && pnpm test`
Expected: All tests pass.

- [ ] **Step 6: Run linting**

Run: `pnpm --filter @ultra/backend lint && pnpm --filter @ultra/desktop lint`
Expected: No lint errors.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Migration 0002 | `apps/backend/src/db/migrations.ts` |
| 2 | `getLayout()` + `setLayout()` | `apps/backend/src/projects/project-service.ts`, `*.test.ts` |
| 3 | Router handlers | `apps/backend/src/ipc/router.ts` |
| 4 | Capability flag | `apps/backend/src/system/system-service.ts` |
| 5 | `setLayoutField()` + debounce | `apps/desktop/src/renderer/src/state/app-store.tsx`, `*test.tsx` |
| 6 | Startup hydration | `apps/desktop/src/renderer/src/projects/project-workflows.ts`, `*.test.ts` |
| 7 | Verification | typecheck + test + lint |
