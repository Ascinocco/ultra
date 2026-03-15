# ULR-67: Compact Header Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all navigation into the Electron title bar, eliminating the dedicated header row and maximizing vertical content space.

**Architecture:** Replace the 3-component header (ProjectFrame, TopNav, RuntimeIndicator) with a single TitleBar component containing a ProjectSelector dropdown and centered TopNav pills. The title bar uses `titleBarStyle: 'hidden'` for custom content in the Electron chrome area.

**Tech Stack:** React, Zustand, plain CSS, Electron BrowserWindow API, Vitest

**Note on testing:** Interactive tests (popover open/close, click handlers, keyboard navigation) require `@testing-library/react` which is not yet set up in this project. This plan covers static rendering tests via `renderToStaticMarkup`. Interactive tests should be added in a follow-up when RTL is introduced.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/desktop/src/renderer/src/components/TitleBar.tsx` | Title bar container with drag region, grid layout |
| Create | `apps/desktop/src/renderer/src/components/ProjectSelector.tsx` | Dropdown trigger pill + popover for project switching |
| Modify | `apps/desktop/src/renderer/src/components/AppShell.tsx` | Replace header with TitleBar, remove RuntimeIndicator/ProjectFrame |
| Modify | `apps/desktop/src/renderer/src/styles/app.css` | Remove old header/frame/indicator CSS, add title bar + selector CSS |
| Modify | `apps/desktop/src/main/index.ts` | Add `titleBarStyle: 'hidden'` and `trafficLightPosition` |
| Delete | `apps/desktop/src/renderer/src/components/RuntimeIndicator.tsx` | Remove entirely |
| Delete | `apps/desktop/src/renderer/src/components/ProjectFrame.tsx` | Remove entirely (replaced by ProjectSelector) |
| Modify | `apps/desktop/src/renderer/src/app-shell.test.tsx` | Update tests for new component structure |

---

## Chunk 1: Electron Config + New Components + AppShell Rewrite

All component changes happen in a single chunk so the tree is never in a broken intermediate state.

### Task 1: Configure Electron Hidden Title Bar

**Files:**
- Modify: `apps/desktop/src/main/index.ts:25-37`

- [ ] **Step 1: Add titleBarStyle and trafficLightPosition to BrowserWindow**

In `apps/desktop/src/main/index.ts`, update the `BrowserWindow` constructor options:

```typescript
function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 12 },
    title: buildPlaceholderProjectLabel(APP_NAME),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat: configure Electron hidden title bar with traffic light positioning"
```

### Task 2: Create ProjectSelector Component

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ProjectSelector.tsx`

- [ ] **Step 1: Write the ProjectSelector component**

Uses `createPortal` to render popover at document body root. Resets `itemsRef` on each open. Applies muted styling to trigger when `canOpenProjects` is false via a `data-muted` attribute.

```tsx
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ProjectSnapshot } from "@ultra/shared"

export function ProjectSelector({
  activeProject,
  recentProjects,
  canOpenProjects,
  openStatus,
  openError,
  onOpenProject,
  onOpenRecentProject,
}: {
  activeProject: ProjectSnapshot | null
  recentProjects: ProjectSnapshot[]
  canOpenProjects: boolean
  openStatus: "idle" | "opening" | "error"
  openError: string | null
  onOpenProject: () => void
  onOpenRecentProject: (project: ProjectSnapshot) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLButtonElement[]>([])
  const isOpening = openStatus === "opening"

  const triggerLabel = isOpening
    ? "Opening\u2026"
    : activeProject
      ? activeProject.name
      : "Open Project"

  const close = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Reset item refs and focus first item on open
  useEffect(() => {
    if (isOpen) {
      itemsRef.current = []
      requestAnimationFrame(() => {
        itemsRef.current[0]?.focus()
      })
    }
  }, [isOpen])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        close()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen, close])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, close])

  function handleKeyNavigation(event: React.KeyboardEvent) {
    const items = itemsRef.current.filter(Boolean)
    const currentIndex = items.indexOf(event.target as HTMLButtonElement)
    if (currentIndex === -1) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      const next = items[currentIndex + 1]
      if (next) next.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const prev = items[currentIndex - 1]
      if (prev) prev.focus()
    } else if (event.key === "Tab") {
      if (!event.shiftKey && currentIndex === items.length - 1) {
        event.preventDefault()
        close()
      }
    }
  }

  function registerItem(el: HTMLButtonElement | null) {
    if (el && !itemsRef.current.includes(el)) {
      itemsRef.current.push(el)
    }
  }

  // Calculate popover position relative to trigger
  function getPopoverPosition() {
    if (!triggerRef.current) return { top: 48, left: 70 }
    const rect = triggerRef.current.getBoundingClientRect()
    const left = rect.left
    const wouldOverflowRight = left + 320 > window.innerWidth
    return {
      top: rect.bottom + 8,
      left: wouldOverflowRight ? Math.max(16, rect.right - 320) : left,
    }
  }

  const popover = isOpen ? (
    <div
      ref={popoverRef}
      className="project-selector__popover"
      role="menu"
      style={getPopoverPosition()}
      onKeyDown={handleKeyNavigation}
    >
      {/* Active project info */}
      {activeProject ? (
        <div className="project-selector__popover-section">
          <p className="project-selector__popover-name">
            {activeProject.name}
          </p>
          <p className="project-selector__popover-path">
            {activeProject.rootPath}
          </p>
          {activeProject.gitRootPath &&
          activeProject.gitRootPath !== activeProject.rootPath ? (
            <p className="project-selector__popover-meta">
              repo: {activeProject.gitRootPath}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="project-selector__popover-section">
          <p className="project-selector__popover-name">No project open</p>
        </div>
      )}

      {/* Recent projects */}
      {recentProjects.length > 0 ? (
        <div className="project-selector__popover-section">
          <p className="project-selector__popover-label">Recent</p>
          {recentProjects.slice(0, 3).map((project) => (
            <button
              key={project.id}
              ref={registerItem}
              className="project-selector__popover-item"
              role="menuitem"
              type="button"
              disabled={!canOpenProjects || isOpening}
              onClick={() => {
                onOpenRecentProject(project)
                close()
              }}
            >
              <span>{project.name}</span>
              <small>{project.rootPath}</small>
            </button>
          ))}
        </div>
      ) : null}

      {/* Open Project action */}
      <div className="project-selector__popover-section">
        <button
          ref={registerItem}
          className="project-selector__popover-action"
          role="menuitem"
          type="button"
          disabled={!canOpenProjects || isOpening}
          onClick={() => {
            onOpenProject()
            close()
          }}
        >
          Open Project{"\u2026"}
        </button>
      </div>

      {/* Error */}
      {openError ? (
        <p className="project-selector__popover-error">{openError}</p>
      ) : null}
    </div>
  ) : null

  return (
    <div className="project-selector">
      <button
        ref={triggerRef}
        className="project-selector__trigger"
        data-muted={!canOpenProjects || undefined}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="project-selector__trigger-name">{triggerLabel}</span>
        <span aria-hidden="true" className="project-selector__trigger-chevron">
          &#9660;
        </span>
      </button>

      {popover && createPortal(popover, document.body)}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ProjectSelector.tsx
git commit -m "feat: add ProjectSelector dropdown component with portal popover"
```

### Task 3: Create TitleBar Component

**Files:**
- Create: `apps/desktop/src/renderer/src/components/TitleBar.tsx`

- [ ] **Step 1: Write the TitleBar component**

```tsx
import type { ProjectSnapshot } from "@ultra/shared"
import type { AppPage } from "../state/app-store.js"
import { ProjectSelector } from "./ProjectSelector.js"
import { TopNav } from "./TopNav.js"

export function TitleBar({
  currentPage,
  onSelectPage,
  activeProject,
  recentProjects,
  canOpenProjects,
  openStatus,
  openError,
  onOpenProject,
  onOpenRecentProject,
}: {
  currentPage: AppPage
  onSelectPage: (page: AppPage) => void
  activeProject: ProjectSnapshot | null
  recentProjects: ProjectSnapshot[]
  canOpenProjects: boolean
  openStatus: "idle" | "opening" | "error"
  openError: string | null
  onOpenProject: () => void
  onOpenRecentProject: (project: ProjectSnapshot) => void
}) {
  return (
    <div className="title-bar">
      <ProjectSelector
        activeProject={activeProject}
        recentProjects={recentProjects}
        canOpenProjects={canOpenProjects}
        openStatus={openStatus}
        openError={openError}
        onOpenProject={onOpenProject}
        onOpenRecentProject={onOpenRecentProject}
      />
      <TopNav currentPage={currentPage} onSelectPage={onSelectPage} />
      <div />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/components/TitleBar.tsx
git commit -m "feat: add TitleBar container component"
```

### Task 4: Rewrite AppShell + Delete Old Components

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/AppShell.tsx`
- Delete: `apps/desktop/src/renderer/src/components/RuntimeIndicator.tsx`
- Delete: `apps/desktop/src/renderer/src/components/ProjectFrame.tsx`

- [ ] **Step 1: Verify no other consumers of RuntimeIndicator or ProjectFrame**

```bash
cd apps/desktop && grep -r "RuntimeIndicator\|getConnectionStatusMeta" src/ --include="*.ts" --include="*.tsx" | grep -v RuntimeIndicator.tsx
cd apps/desktop && grep -r "ProjectFrame" src/ --include="*.ts" --include="*.tsx" | grep -v ProjectFrame.tsx
```

Expected: only `AppShell.tsx` and `app-shell.test.tsx` import these.

- [ ] **Step 2: Replace AppShell.tsx contents**

```tsx
import type { ProjectSnapshot } from "@ultra/shared"
import { useEffect, useRef } from "react"

import { BrowserPageShell } from "../pages/BrowserPageShell.js"
import { ChatPageShell } from "../pages/ChatPageShell.js"
import { EditorPageShell } from "../pages/EditorPageShell.js"
import {
  hydrateLastProject,
  openProjectFromPath,
  openProjectFromPicker,
} from "../projects/project-workflows.js"
import { useAppStore } from "../state/app-store.js"
import { TitleBar } from "./TitleBar.js"

export function AppShell() {
  const app = useAppStore((state) => state.app)
  const projects = useAppStore((state) => state.projects)
  const setCurrentPage = useAppStore((state) => state.actions.setCurrentPage)
  const actions = useAppStore((state) => state.actions)
  const loadedProjectsSessionRef = useRef<string | null>(null)

  const activeProject = app.activeProjectId
    ? (projects.byId[app.activeProjectId] ?? null)
    : null
  const recentProjects = projects.allIds
    .map((projectId) => projects.byId[projectId])
    .filter(
      (project): project is ProjectSnapshot =>
        project !== undefined && project.id !== app.activeProjectId,
    )
  const canOpenProjects =
    app.connectionStatus === "connected" &&
    Boolean(app.capabilities?.supportsProjects)

  useEffect(() => {
    if (!canOpenProjects) {
      loadedProjectsSessionRef.current = null
      return
    }

    const sessionId = app.backendStatus.sessionId ?? "connected"
    if (loadedProjectsSessionRef.current === sessionId) {
      return
    }

    loadedProjectsSessionRef.current = sessionId

    void hydrateLastProject(actions, app.capabilities).catch(() => undefined)
  }, [actions, app.backendStatus.sessionId, app.capabilities, canOpenProjects])

  async function handleOpenProject() {
    await openProjectFromPicker(
      () => window.ultraShell.pickProjectDirectory(),
      actions,
      app.capabilities,
    )
  }

  async function handleOpenRecentProject(project: ProjectSnapshot) {
    await openProjectFromPath(project.rootPath, actions, app.capabilities)
  }

  return (
    <main className="app-shell">
      <TitleBar
        currentPage={app.currentPage}
        onSelectPage={setCurrentPage}
        activeProject={activeProject}
        recentProjects={recentProjects}
        canOpenProjects={canOpenProjects}
        openStatus={app.projectOpenStatus}
        openError={app.projectOpenError}
        onOpenProject={() => {
          void handleOpenProject()
        }}
        onOpenRecentProject={(project) => {
          void handleOpenRecentProject(project)
        }}
      />

      <section className="app-shell__body">
        <ChatPageShell active={app.currentPage === "chat"} />
        <EditorPageShell active={app.currentPage === "editor"} />
        <BrowserPageShell active={app.currentPage === "browser"} />
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Delete old component files**

```bash
rm apps/desktop/src/renderer/src/components/RuntimeIndicator.tsx
rm apps/desktop/src/renderer/src/components/ProjectFrame.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/AppShell.tsx
git add -u apps/desktop/src/renderer/src/components/RuntimeIndicator.tsx
git add -u apps/desktop/src/renderer/src/components/ProjectFrame.tsx
git commit -m "refactor: replace header with TitleBar, delete RuntimeIndicator and ProjectFrame"
```

---

## Chunk 2: CSS Overhaul

### Task 5: Clean Up Old CSS and Add Title Bar + ProjectSelector CSS

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Remove old header CSS**

Remove these blocks:
- `.app-shell__header` block (the `display: grid; grid-template-columns...` rule)
- `.app-shell__nav-wrap` block

- [ ] **Step 2: Remove old ProjectFrame CSS**

Remove the entire `/* ── Project Frame */` section. **Important:** The `.project-frame__eyebrow` rule is combined with `.surface__eyebrow`. When removing it, preserve the `.surface__eyebrow` rule:

```css
/* Keep this rule (was shared with .project-frame__eyebrow): */
.surface__eyebrow {
  margin: 0;
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}
```

Remove everything else from `.project-frame` through `.project-frame__recent-button small` and the `.placeholder-card p` rule between them.

- [ ] **Step 3: Remove old RuntimeIndicator CSS**

Remove the entire `/* ── Runtime Indicator */` section (`.runtime-indicator` through `.runtime-indicator__detail`).

- [ ] **Step 4: Remove old responsive media query**

Remove the entire `@media (max-width: 1200px)` block.

- [ ] **Step 5: Update `.app-shell` to remove header grid row and add title bar padding**

Replace the existing `.app-shell` block:

```css
.app-shell {
  min-height: 100vh;
  padding: 0 20px 20px;
  padding-top: 48px; /* title bar height (40px) + 8px gap */
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  box-sizing: border-box;
}
```

- [ ] **Step 6: Update `.page-shell` min-height calculation**

```css
.page-shell {
  min-height: calc(100vh - 68px); /* 48px top padding + 20px bottom padding */
}
```

- [ ] **Step 7: Add title bar CSS**

Add after the `.app-shell__body` rule:

```css
/* ── Title Bar ────────────────────────────────────────────── */

.title-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 16px 0 70px; /* 70px left for macOS traffic lights */
  -webkit-app-region: drag;
  z-index: 100;
  background: var(--shell-bg);
  box-sizing: border-box;
}
```

- [ ] **Step 8: Add project selector CSS**

Add after the title bar CSS:

```css
/* ── Project Selector ─────────────────────────────────────── */

.project-selector {
  justify-self: start;
  -webkit-app-region: no-drag;
}

.project-selector__trigger {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: rgba(148, 163, 200, 0.08);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  max-width: 200px;
  -webkit-app-region: no-drag;
}

.project-selector__trigger:hover {
  background: rgba(148, 163, 200, 0.14);
}

.project-selector__trigger[data-muted] {
  opacity: 0.55;
}

.project-selector__trigger-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-selector__trigger-chevron {
  color: var(--text-muted);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.project-selector__popover {
  position: fixed;
  width: 320px;
  max-width: calc(100vw - 32px);
  background: var(--surface-2);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 12px;
  z-index: 1000;
  -webkit-app-region: no-drag;
  box-sizing: border-box;
}

.project-selector__popover-section {
  padding: 4px 0;
}

.project-selector__popover-section + .project-selector__popover-section {
  border-top: 1px solid var(--surface-border);
  margin-top: 8px;
  padding-top: 8px;
}

.project-selector__popover-name {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}

.project-selector__popover-path {
  margin: 2px 0 0;
  font-size: 0.76rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-selector__popover-meta {
  margin: 1px 0 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.project-selector__popover-label {
  margin: 0 0 6px;
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.project-selector__popover-item {
  appearance: none;
  display: grid;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.project-selector__popover-item:hover {
  background: rgba(148, 163, 200, 0.08);
  color: var(--text-primary);
}

.project-selector__popover-item:disabled {
  opacity: 0.55;
  cursor: default;
}

.project-selector__popover-item:disabled:hover {
  background: transparent;
  color: var(--text-secondary);
}

.project-selector__popover-item small {
  font-size: 0.7rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-selector__popover-action {
  appearance: none;
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--accent-strong);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.project-selector__popover-action:hover {
  background: rgba(91, 141, 239, 0.08);
}

.project-selector__popover-action:disabled {
  opacity: 0.55;
  cursor: default;
}

.project-selector__popover-action:disabled:hover {
  background: transparent;
}

.project-selector__popover-error {
  margin: 4px 0 0;
  font-size: 0.76rem;
  color: var(--danger);
}
```

- [ ] **Step 9: Update TopNav pill CSS for title bar fit and add no-drag**

Update the existing `.top-nav` and `.top-nav__pill` rules. Add `-webkit-app-region: no-drag` to `.top-nav` so pills are clickable inside the drag region:

```css
.top-nav {
  display: inline-grid;
  grid-auto-flow: column;
  gap: 4px;
  padding: 5px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--surface-border);
  box-shadow: var(--shadow-md);
  -webkit-app-region: no-drag;
}

.top-nav__pill {
  appearance: none;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  padding: 6px 10px;
  font-size: 0.86rem;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease,
    transform 120ms ease;
}
```

- [ ] **Step 10: Add responsive breakpoint**

```css
/* ── Responsive ────────────────────────────────────────────── */

@media (max-width: 900px) {
  .top-nav__pill {
    padding: 4px 8px;
    font-size: 0.82rem;
  }

  .project-selector__trigger {
    max-width: 140px;
  }

  .chat-layout,
  .chat-layout__main {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "refactor: replace header CSS with title bar and project selector styles"
```

---

## Chunk 3: Tests + Verification

### Task 6: Update Tests

**Files:**
- Modify: `apps/desktop/src/renderer/src/app-shell.test.tsx`

- [ ] **Step 1: Update test file**

Changes needed:
1. Remove `ProjectFrame` import, add `ProjectSelector` import
2. Remove "renders every runtime status label" test (RuntimeIndicator gone)
3. Remove "renders backend detail messaging" test (RuntimeIndicator gone)
4. Remove "Starting local backend" assertion from defaults test
5. Add "renders title bar with project selector and nav" test
6. Replace `ProjectFrame` describe block with `ProjectSelector` describe block
7. Keep the `makeProject` helper function at the bottom unchanged
8. Keep all `describe("app store", ...)` tests unchanged

The full updated file should have these test blocks:

**Updated imports:**
```tsx
import { AppShell } from "./components/AppShell.js"
import { ProjectSelector } from "./components/ProjectSelector.js"
```

Remove the `ProjectFrame` import.

**Updated AppShell describe block:**

```tsx
describe("AppShell", () => {
  it("defaults to the Chat page", () => {
    const markup = renderShell()

    expect(markup).toContain('data-page="chat"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain(">Chat</button>")
    expect(markup).toContain("No chats yet")
    expect(markup).toContain("Open Project")
  })

  it("marks only the selected pill as active", () => {
    const markup = renderShell({ currentPage: "browser" })

    expect(markup).toContain(">Browser</button>")
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it("keeps all page shells mounted in the router", () => {
    const markup = renderShell({ currentPage: "editor" })

    expect(markup).toContain('data-page="chat"')
    expect(markup).toContain('data-page="editor"')
    expect(markup).toContain('data-page="browser"')
  })

  it("renders the title bar with project selector and nav", () => {
    const markup = renderShell()

    expect(markup).toContain("title-bar")
    expect(markup).toContain("project-selector")
    expect(markup).toContain("top-nav")
  })
})
```

**Replace ProjectFrame describe block with:**

```tsx
describe("ProjectSelector", () => {
  it("renders trigger with project name when project is active", () => {
    const markup = renderToStaticMarkup(
      <ProjectSelector
        activeProject={makeProject("proj-1", "Alpha")}
        recentProjects={[]}
        canOpenProjects={true}
        openStatus="idle"
        openError={null}
        onOpenProject={() => undefined}
        onOpenRecentProject={() => undefined}
      />,
    )

    expect(markup).toContain("Alpha")
    expect(markup).toContain("project-selector__trigger")
  })

  it("renders 'Open Project' trigger when no project is active", () => {
    const markup = renderToStaticMarkup(
      <ProjectSelector
        activeProject={null}
        recentProjects={[]}
        canOpenProjects={true}
        openStatus="idle"
        openError={null}
        onOpenProject={() => undefined}
        onOpenRecentProject={() => undefined}
      />,
    )

    expect(markup).toContain("Open Project")
  })

  it("renders 'Opening...' when status is opening", () => {
    const markup = renderToStaticMarkup(
      <ProjectSelector
        activeProject={null}
        recentProjects={[]}
        canOpenProjects={true}
        openStatus="opening"
        openError={null}
        onOpenProject={() => undefined}
        onOpenRecentProject={() => undefined}
      />,
    )

    expect(markup).toContain("Opening")
  })

  it("starts with popover closed", () => {
    const markup = renderToStaticMarkup(
      <ProjectSelector
        activeProject={makeProject("proj-1", "Alpha")}
        recentProjects={[makeProject("proj-2", "Beta")]}
        canOpenProjects={true}
        openStatus="idle"
        openError={null}
        onOpenProject={() => undefined}
        onOpenRecentProject={() => undefined}
      />,
    )

    expect(markup).toContain("Alpha")
    expect(markup).not.toContain("project-selector__popover")
  })

  it("applies muted attribute when canOpenProjects is false", () => {
    const markup = renderToStaticMarkup(
      <ProjectSelector
        activeProject={makeProject("proj-1", "Alpha")}
        recentProjects={[]}
        canOpenProjects={false}
        openStatus="idle"
        openError={null}
        onOpenProject={() => undefined}
        onOpenRecentProject={() => undefined}
      />,
    )

    expect(markup).toContain("data-muted")
  })

  it("renders aria attributes on trigger", () => {
    const markup = renderToStaticMarkup(
      <ProjectSelector
        activeProject={null}
        recentProjects={[]}
        canOpenProjects={true}
        openStatus="idle"
        openError={null}
        onOpenProject={() => undefined}
        onOpenRecentProject={() => undefined}
      />,
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-haspopup="true"')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd apps/desktop && pnpm vitest run src/renderer/src/app-shell.test.tsx
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "test: update tests for title bar and project selector"
```

### Task 7: Full Verification

- [ ] **Step 1: Run full typecheck**

```bash
pnpm --filter @ultra/desktop exec tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm --filter @ultra/desktop vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

```bash
pnpm --filter @ultra/desktop exec eslint src/
```

Expected: no lint errors.

- [ ] **Step 4: Visual verification checklist**

Start the dev server and manually verify:
- [ ] Window dragging works on title bar area (not on interactive elements)
- [ ] Traffic lights positioned correctly on macOS
- [ ] TopNav pills centered in title bar and clickable
- [ ] Project selector trigger shows "Open Project" when no project active
- [ ] ProjectSelector popover opens/closes on click
- [ ] Progressive compacting at narrow window widths
- [ ] No vertical stacking at any width
- [ ] Page content has proper spacing below title bar
