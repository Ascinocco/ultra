# ULR-30: Terminal Drawer & Sandbox Selector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resizable terminal drawer shell and sandbox selector pill to complete the ULR-30 chat workspace layout.

**Architecture:** The terminal drawer is a grid row in `.chat-frame__grid` toggled via store state. The sandbox selector is a pill/dropdown in the title bar that uses existing sandbox IPC contracts. Both are structural shells — real terminal sessions (ULR-31) and deeper sandbox workflows come later.

**Tech Stack:** React 19, Zustand 5, CSS grid, Vitest with `renderToStaticMarkup`, existing IPC client patterns.

**Spec:** `docs/superpowers/specs/2026-03-15-ulr-30-terminal-drawer-sandbox-selector-design.md`

---

## Chunk 1: Terminal Drawer

### Task 1: Add terminal drawer state to the store

**Files:**
- Modify: `apps/desktop/src/renderer/src/state/app-store.tsx`
- Modify: `apps/desktop/src/renderer/src/app-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/src/renderer/src/app-shell.test.tsx` — a new `describe("terminal drawer state")` block after the existing `describe("sidebar slice")`:

```typescript
describe("terminal drawer state", () => {
  it("starts with terminal drawer closed", () => {
    const store = createAppStore()

    expect(store.getState().app.terminalDrawerOpen).toBe(false)
  })

  it("toggleTerminalDrawer opens and closes the drawer", () => {
    const store = createAppStore()

    store.getState().actions.toggleTerminalDrawer()
    expect(store.getState().app.terminalDrawerOpen).toBe(true)

    store.getState().actions.toggleTerminalDrawer()
    expect(store.getState().app.terminalDrawerOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/app-shell.test.tsx`
Expected: FAIL — `terminalDrawerOpen` does not exist on state, `toggleTerminalDrawer` does not exist on actions.

- [ ] **Step 3: Implement the store changes**

In `apps/desktop/src/renderer/src/state/app-store.tsx`:

1. Add `terminalDrawerOpen: boolean` to the `AppSlice` type (after `projectOpenError`).

2. Add `toggleTerminalDrawer: () => void` to the `AppActions` type.

3. Add `terminalDrawerOpen: false` to `defaultAppState`.

4. Add `toggleTerminalDrawer: () => undefined` to the stub actions in `buildInitialState`.

5. Add the real action in `createAppStore`:
```typescript
toggleTerminalDrawer: () =>
  set((state) => ({
    ...state,
    app: { ...state.app, terminalDrawerOpen: !state.app.terminalDrawerOpen },
  })),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/src/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/state/app-store.tsx apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "feat(store): add terminal drawer open/close state"
```

---

### Task 2: Build the TerminalDrawer component

**Files:**
- Create: `apps/desktop/src/renderer/src/terminal/TerminalDrawer.tsx`
- Create: `apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx`:

```typescript
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TerminalDrawer } from "./TerminalDrawer.js"

function renderDrawer(props?: Partial<Parameters<typeof TerminalDrawer>[0]>) {
  return renderToStaticMarkup(
    <TerminalDrawer
      height={200}
      onResize={() => undefined}
      onClose={() => undefined}
      {...props}
    />,
  )
}

describe("TerminalDrawer", () => {
  it("renders the terminal drawer container", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer")
  })

  it("renders a drag handle", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer__drag-handle")
  })

  it("renders the header with Terminal label", () => {
    const markup = renderDrawer()

    expect(markup).toContain("Terminal")
  })

  it("renders a close button", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer__close")
  })

  it("renders the placeholder content area", () => {
    const markup = renderDrawer()

    expect(markup).toContain("terminal-drawer__content")
  })

  it("applies height via inline style", () => {
    const markup = renderDrawer({ height: 300 })

    expect(markup).toContain("300px")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/desktop/src/renderer/src/terminal/TerminalDrawer.tsx`:

```typescript
export function TerminalDrawer({
  height,
  onResize,
  onClose,
}: {
  height: number
  onResize: (height: number) => void
  onClose: () => void
}) {
  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = startY - moveEvent.clientY
      const newHeight = Math.max(100, startHeight + delta)
      onResize(newHeight)
    }

    function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
    }

    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
  }

  return (
    <div
      className="terminal-drawer"
      style={{ height: `${height}px` }}
    >
      <div
        className="terminal-drawer__drag-handle"
        onPointerDown={handlePointerDown}
      />
      <div className="terminal-drawer__header">
        <span className="terminal-drawer__title">Terminal</span>
        <button
          className="terminal-drawer__close"
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
        >
          ×
        </button>
      </div>
      <div className="terminal-drawer__content">
        <p className="terminal-drawer__placeholder">
          Terminal sessions will appear here
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/terminal/TerminalDrawer.tsx apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx
git commit -m "feat(terminal): add TerminalDrawer shell component"
```

---

### Task 3: Integrate TerminalDrawer into ChatPageShell and add CSS

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Modify: `apps/desktop/src/renderer/src/app-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to the `describe("AppShell")` block in `app-shell.test.tsx`:

```typescript
it("renders the terminal drawer when terminalDrawerOpen is true", () => {
  const store = createAppStore()
  store.getState().actions.toggleTerminalDrawer()
  const currentState = store.getState()
  store.getInitialState = () => currentState
  const markup = renderToStaticMarkup(
    <AppStoreProvider store={store}>
      <AppShell />
    </AppStoreProvider>,
  )

  expect(markup).toContain("terminal-drawer")
})

it("does not render the terminal drawer when closed", () => {
  const markup = renderShell()

  expect(markup).not.toContain("terminal-drawer")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/app-shell.test.tsx`
Expected: First test FAILS — terminal drawer not rendered.

- [ ] **Step 3: Update ChatPageShell to accept and render the terminal drawer**

Update `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`:

```typescript
import { useState } from "react"

import { useAppStore } from "../state/app-store.js"
import { Sidebar } from "../sidebar/Sidebar.js"
import { TerminalDrawer } from "../terminal/TerminalDrawer.js"

const DEFAULT_DRAWER_HEIGHT = 200
const MIN_DRAWER_HEIGHT = 100
const MAX_DRAWER_HEIGHT_RATIO = 0.8

export function ChatPageShell({ active, onOpenProject }: { active: boolean; onOpenProject: () => void }) {
  const terminalDrawerOpen = useAppStore((s) => s.app.terminalDrawerOpen)
  const actions = useAppStore((s) => s.actions)
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT)

  function handleResize(height: number) {
    const chatFrame = document.querySelector(".chat-frame")
    const maxHeight = chatFrame
      ? chatFrame.clientHeight * MAX_DRAWER_HEIGHT_RATIO
      : 600
    setDrawerHeight(Math.min(Math.max(height, MIN_DRAWER_HEIGHT), maxHeight))
  }

  return (
    <section
      aria-hidden={!active}
      className={`page-shell ${active ? "page-shell--active" : "page-shell--hidden"}`}
      data-page="chat"
    >
      <div className="chat-frame">
        <div className="chat-frame__grid">
          <aside className="chat-frame__rail">
            <Sidebar onOpenProject={onOpenProject} />
          </aside>

          <section className="chat-frame__main">
            <div className="surface__header">
              <p className="surface__eyebrow">Active Chat</p>
              <h2 className="surface__title">Command center</h2>
            </div>
            <div className="placeholder-card placeholder-card--tall">
              <strong>Plan, spec, and execution setup live here</strong>
              <p>
                The left anchor stays focused on conversation while the right
                side tracks thread execution and runtime health.
              </p>
            </div>
          </section>

          <div className="chat-frame__side">
            <section className="chat-frame__side-top">
              <div className="surface__header">
                <p className="surface__eyebrow">Threads</p>
                <h2 className="surface__title">Execution pane</h2>
              </div>
              <div className="placeholder-card">
                <strong>No threads yet</strong>
                <p>
                  Thread cards and thread detail will expand inside this pane
                  without replacing the chat anchor.
                </p>
              </div>
            </section>
            <section className="chat-frame__side-bottom">
              <div className="surface__header">
                <p className="surface__eyebrow">Status</p>
                <h2 className="surface__title">Runtime summary</h2>
              </div>
              <div className="placeholder-card">
                <strong>Runtime health stays visible</strong>
                <p>
                  This region will hold coordinator, watchdog, and approval
                  state without turning the page into an ops console.
                </p>
              </div>
            </section>
          </div>

          {terminalDrawerOpen && (
            <TerminalDrawer
              height={drawerHeight}
              onResize={handleResize}
              onClose={() => actions.toggleTerminalDrawer()}
            />
          )}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add terminal drawer CSS and update grid placement**

Add to `apps/desktop/src/renderer/src/styles/app.css`:

1. Update `.chat-frame__grid` to define explicit rows and add grid placement to children:

```css
.chat-frame__grid {
  /* add to existing rule: */
  grid-template-rows: minmax(0, 1fr);
}

.chat-frame__rail {
  /* add to existing rule: */
  grid-row: 1 / -1;
}

.chat-frame__main {
  /* add to existing rule: */
  grid-row: 1;
  overflow: auto;
}

.chat-frame__side {
  /* add to existing rule: */
  grid-row: 1;
}
```

2. Add terminal drawer styles (new section after the Sidebar section):

```css
/* ── Terminal Drawer ─────────────────────────────────────── */

.terminal-drawer {
  grid-column: 2 / -1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  background: var(--shell-bg);
  border-top: 1px solid var(--panel-border);
  min-height: 100px;
  overflow: hidden;
}

.terminal-drawer__drag-handle {
  height: 4px;
  cursor: row-resize;
  flex-shrink: 0;
}

.terminal-drawer__drag-handle:hover {
  background: var(--panel-border);
}

.terminal-drawer__header {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  border-bottom: 1px solid var(--panel-border);
  flex-shrink: 0;
}

.terminal-drawer__title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.terminal-drawer__close {
  appearance: none;
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 1rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}

.terminal-drawer__close:hover {
  background: rgba(148, 163, 200, 0.08);
  color: var(--text-primary);
}

.terminal-drawer__content {
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
}

.terminal-drawer__placeholder {
  color: var(--text-muted);
  font-size: 0.82rem;
}
```

3. Add responsive rule inside the existing `@media (max-width: 900px)` block:

```css
.terminal-drawer {
  grid-column: 1 / -1;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ChatPageShell.tsx apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "feat(terminal): integrate TerminalDrawer into chat layout"
```

---

### Task 4: Add TitleBar terminal toggle and keyboard shortcut

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/TitleBar.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AppShell.tsx`
- Modify: `apps/desktop/src/renderer/src/app-shell.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Write the failing tests**

Add to `describe("AppShell")` in `app-shell.test.tsx`:

```typescript
it("renders a terminal toggle button in the title bar", () => {
  const markup = renderShell()

  expect(markup).toContain("title-bar__terminal-toggle")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/app-shell.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update TitleBar to accept and render terminal toggle**

Update `apps/desktop/src/renderer/src/components/TitleBar.tsx`:

```typescript
export function TitleBar({
  terminalOpen,
  onToggleTerminal,
  children,
}: {
  terminalOpen?: boolean
  onToggleTerminal?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="title-bar">
      <div className="title-bar__actions">
        <button
          className={`title-bar__terminal-toggle ${terminalOpen ? "title-bar__terminal-toggle--active" : ""}`}
          type="button"
          onClick={onToggleTerminal}
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update AppShell to pass terminal state to TitleBar and add keyboard shortcut**

Update `apps/desktop/src/renderer/src/components/AppShell.tsx`:

Add `useEffect` for keyboard shortcut and pass props to `TitleBar`:

Add the keyboard shortcut effect and update the TitleBar JSX. Key changes to `AppShell.tsx`:

1. Add a `useEffect` for the keyboard shortcut after the existing project hydration effect:
```typescript
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    const isToggleTerminal =
      e.key === "`" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
    if (isToggleTerminal) {
      e.preventDefault()
      actions.toggleTerminalDrawer()
    }
  }

  window.addEventListener("keydown", handleKeyDown)
  return () => window.removeEventListener("keydown", handleKeyDown)
}, [actions])
```

2. Update the TitleBar JSX to pass terminal props:
```typescript
<TitleBar
  terminalOpen={app.terminalDrawerOpen}
  onToggleTerminal={() => actions.toggleTerminalDrawer()}
/>
```

3. Remove the unused `import type { ProjectSnapshot } from "@ultra/shared"` line (it has no references in AppShell).

- [ ] **Step 5: Add title bar action styles**

Add to `apps/desktop/src/renderer/src/styles/app.css` after the `.title-bar` rule:

```css
.title-bar__actions {
  position: absolute;
  right: 12px;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.title-bar__terminal-toggle {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.title-bar__terminal-toggle:hover {
  background: rgba(148, 163, 200, 0.08);
  color: var(--text-secondary);
}

.title-bar__terminal-toggle--active {
  color: var(--text-primary);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: ALL tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/TitleBar.tsx apps/desktop/src/renderer/src/components/AppShell.tsx apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "feat(terminal): add title bar toggle and keyboard shortcut"
```

---

## Chunk 2: Sandbox Selector

### Task 5: Add test factory helper for sandboxes

**Files:**
- Modify: `apps/desktop/src/renderer/src/test-utils/factories.ts`

- [ ] **Step 1: Add makeSandbox factory**

Update the import line in `apps/desktop/src/renderer/src/test-utils/factories.ts`:

```typescript
import type { ChatSummary, ProjectSnapshot, SandboxContextSnapshot } from "@ultra/shared"
```

Add the factory function:

```typescript
export function makeSandbox(
  id: string,
  projectId: string,
  opts?: Partial<SandboxContextSnapshot>,
): SandboxContextSnapshot {
  return {
    sandboxId: id,
    projectId,
    threadId: null,
    path: `/projects/${projectId}`,
    displayName: `Sandbox ${id}`,
    sandboxType: "main_checkout",
    branchName: "main",
    baseBranch: null,
    isMainCheckout: true,
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    lastUsedAt: null,
    ...opts,
  }
}
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npx vitest run`
Expected: ALL tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/test-utils/factories.ts
git commit -m "feat(test): add makeSandbox factory helper"
```

---

### Task 6: Add sandbox slice to the store

**Files:**
- Modify: `apps/desktop/src/renderer/src/state/app-store.tsx`
- Modify: `apps/desktop/src/renderer/src/app-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add import at top of `app-shell.test.tsx`:
```typescript
import { makeSandbox } from "./test-utils/factories.js"
```

Add a new `describe("sandbox slice")` block in `app-shell.test.tsx`:

```typescript
describe("sandbox slice", () => {
  it("starts with empty sandbox state", () => {
    const store = createAppStore()
    const { sandbox } = store.getState()

    expect(sandbox.activeSandbox).toBeNull()
    expect(sandbox.sandboxes).toEqual([])
    expect(sandbox.sandboxFetchStatus).toBe("idle")
  })

  it("setSandboxes stores the sandbox list", () => {
    const store = createAppStore()
    const sb = makeSandbox("sb-1", "proj-1", { displayName: "main checkout" })

    store.getState().actions.setSandboxes([sb])

    expect(store.getState().sandbox.sandboxes).toHaveLength(1)
    expect(store.getState().sandbox.sandboxes[0]?.displayName).toBe("main checkout")
  })

  it("setActiveSandbox sets the active sandbox", () => {
    const store = createAppStore()
    const sb = makeSandbox("sb-1", "proj-1", { displayName: "main checkout" })

    store.getState().actions.setActiveSandbox(sb)

    expect(store.getState().sandbox.activeSandbox?.displayName).toBe("main checkout")
  })

  it("setSandboxFetchStatus tracks loading state", () => {
    const store = createAppStore()

    store.getState().actions.setSandboxFetchStatus("loading")
    expect(store.getState().sandbox.sandboxFetchStatus).toBe("loading")

    store.getState().actions.setSandboxFetchStatus("error")
    expect(store.getState().sandbox.sandboxFetchStatus).toBe("error")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/app-shell.test.tsx`
Expected: FAIL — `sandbox` does not exist on state.

- [ ] **Step 3: Implement the sandbox slice**

In `apps/desktop/src/renderer/src/state/app-store.tsx`:

1. Add import at top:
```typescript
import type { SandboxContextSnapshot } from "@ultra/shared"
```

2. Add `SandboxSlice` type after `SidebarSlice`:
```typescript
type SandboxSlice = {
  activeSandbox: SandboxContextSnapshot | null
  sandboxes: SandboxContextSnapshot[]
  sandboxFetchStatus: "idle" | "loading" | "error"
}
```

3. Add sandbox actions to `AppActions`:
```typescript
setSandboxes: (sandboxes: SandboxContextSnapshot[]) => void
setActiveSandbox: (sandbox: SandboxContextSnapshot | null) => void
setSandboxFetchStatus: (status: "idle" | "loading" | "error") => void
```

4. Add `sandbox: SandboxSlice` to `AppStoreState`.

5. Add default state:
```typescript
const defaultSandboxState: SandboxSlice = {
  activeSandbox: null,
  sandboxes: [],
  sandboxFetchStatus: "idle",
}
```

6. Add `sandbox: { ...defaultSandboxState }` to `buildInitialState` return.

7. Add stub actions to `buildInitialState`:
```typescript
setSandboxes: () => undefined,
setActiveSandbox: () => undefined,
setSandboxFetchStatus: () => undefined,
```

8. Add real actions in `createAppStore`:
```typescript
setSandboxes: (sandboxes) =>
  set((state) => ({
    ...state,
    sandbox: { ...state.sandbox, sandboxes },
  })),
setActiveSandbox: (sandbox) =>
  set((state) => ({
    ...state,
    sandbox: { ...state.sandbox, activeSandbox: sandbox },
  })),
setSandboxFetchStatus: (status) =>
  set((state) => ({
    ...state,
    sandbox: { ...state.sandbox, sandboxFetchStatus: status },
  })),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/src/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/state/app-store.tsx apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "feat(store): add sandbox slice with active sandbox and fetch status"
```

---

### Task 7: Add sandbox workflow functions

**Files:**
- Create: `apps/desktop/src/renderer/src/sandbox/sandbox-workflows.ts`
- Create: `apps/desktop/src/renderer/src/sandbox/sandbox-workflows.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/renderer/src/sandbox/sandbox-workflows.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"

import type { AppActions } from "../state/app-store.js"
import { makeSandbox } from "../test-utils/factories.js"
import { hydrateSandboxes, switchSandbox } from "./sandbox-workflows.js"

const sb = makeSandbox("sb-1", "proj-1", { displayName: "main checkout" })

describe("hydrateSandboxes", () => {
  it("fetches sandbox list and active sandbox, then updates store", async () => {
    const actions = {
      setSandboxes: vi.fn(),
      setActiveSandbox: vi.fn(),
      setSandboxFetchStatus: vi.fn(),
    }

    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ sandboxes: [sb] })
        .mockResolvedValueOnce(sb),
      command: vi.fn(),
    }

    await hydrateSandboxes("proj-1", actions, client)

    expect(actions.setSandboxFetchStatus).toHaveBeenCalledWith("loading")
    expect(client.query).toHaveBeenCalledWith("sandboxes.list", { project_id: "proj-1" })
    expect(client.query).toHaveBeenCalledWith("sandboxes.get_active", { project_id: "proj-1" })
    expect(actions.setSandboxes).toHaveBeenCalledWith([sb])
    expect(actions.setActiveSandbox).toHaveBeenCalledWith(sb)
    expect(actions.setSandboxFetchStatus).toHaveBeenLastCalledWith("idle")
  })

  it("sets error status on failure", async () => {
    const actions = {
      setSandboxes: vi.fn(),
      setActiveSandbox: vi.fn(),
      setSandboxFetchStatus: vi.fn(),
    }

    const client = {
      query: vi.fn().mockRejectedValue(new Error("network error")),
      command: vi.fn(),
    }

    await hydrateSandboxes("proj-1", actions, client)

    expect(actions.setSandboxFetchStatus).toHaveBeenCalledWith("loading")
    expect(actions.setSandboxFetchStatus).toHaveBeenLastCalledWith("error")
  })
})

describe("switchSandbox", () => {
  it("calls set_active and updates store on success", async () => {
    const actions = {
      setActiveSandbox: vi.fn(),
    }

    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(sb),
    }

    await switchSandbox("proj-1", "sb-1", actions, client)

    expect(client.command).toHaveBeenCalledWith("sandboxes.set_active", {
      project_id: "proj-1",
      sandbox_id: "sb-1",
    })
    expect(actions.setActiveSandbox).toHaveBeenCalledWith(sb)
  })

  it("propagates errors from set_active", async () => {
    const actions = {
      setActiveSandbox: vi.fn(),
    }

    const client = {
      query: vi.fn(),
      command: vi.fn().mockRejectedValue(new Error("network error")),
    }

    await expect(switchSandbox("proj-1", "sb-1", actions, client)).rejects.toThrow("network error")
    expect(actions.setActiveSandbox).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/sandbox/sandbox-workflows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the workflow functions**

Create `apps/desktop/src/renderer/src/sandbox/sandbox-workflows.ts`:

```typescript
import {
  parseSandboxContextSnapshot,
  parseSandboxesListResult,
} from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command">

export async function hydrateSandboxes(
  projectId: string,
  actions: Pick<AppActions, "setSandboxes" | "setActiveSandbox" | "setSandboxFetchStatus">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  actions.setSandboxFetchStatus("loading")

  try {
    const [listResult, activeResult] = await Promise.all([
      client.query("sandboxes.list", { project_id: projectId }),
      client.query("sandboxes.get_active", { project_id: projectId }),
    ])

    const { sandboxes } = parseSandboxesListResult(listResult)
    const activeSandbox = parseSandboxContextSnapshot(activeResult)

    actions.setSandboxes(sandboxes)
    actions.setActiveSandbox(activeSandbox)
    actions.setSandboxFetchStatus("idle")
  } catch {
    actions.setSandboxFetchStatus("error")
  }
}

export async function switchSandbox(
  projectId: string,
  sandboxId: string,
  actions: Pick<AppActions, "setActiveSandbox">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.command("sandboxes.set_active", {
    project_id: projectId,
    sandbox_id: sandboxId,
  })

  const sandbox = parseSandboxContextSnapshot(result)
  actions.setActiveSandbox(sandbox)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/src/sandbox/sandbox-workflows.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/sandbox/sandbox-workflows.ts apps/desktop/src/renderer/src/sandbox/sandbox-workflows.test.ts
git commit -m "feat(sandbox): add hydrate and switch workflow functions"
```

---

### Task 8: Build the SandboxSelector component

**Files:**
- Create: `apps/desktop/src/renderer/src/sandbox/SandboxSelector.tsx`
- Create: `apps/desktop/src/renderer/src/sandbox/sandbox-selector.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/renderer/src/sandbox/sandbox-selector.test.tsx`:

```typescript
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AppStoreProvider, createAppStore } from "../state/app-store.js"
import { makeSandbox } from "../test-utils/factories.js"
import { SandboxSelector } from "./SandboxSelector.js"

function renderSelector(setup?: (store: ReturnType<typeof createAppStore>) => void) {
  const store = createAppStore()
  setup?.(store)
  const currentState = store.getState()
  store.getInitialState = () => currentState
  return renderToStaticMarkup(
    <AppStoreProvider store={store}>
      <SandboxSelector />
    </AppStoreProvider>,
  )
}

describe("SandboxSelector", () => {
  it("renders nothing when no active project", () => {
    const markup = renderSelector()

    expect(markup).toBe("")
  })

  it("renders nothing when no sandboxes exist", () => {
    const markup = renderSelector((store) => {
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setSandboxes([])
      store.getState().actions.setSandboxFetchStatus("idle")
    })

    expect(markup).toBe("")
  })

  it("shows loading placeholder while fetching", () => {
    const markup = renderSelector((store) => {
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setSandboxFetchStatus("loading")
    })

    expect(markup).toContain("sandbox-selector")
    expect(markup).toContain("…")
  })

  it("shows active sandbox name when loaded", () => {
    const sb = makeSandbox("sb-1", "proj-1", { displayName: "main checkout" })

    const markup = renderSelector((store) => {
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setSandboxes([sb])
      store.getState().actions.setActiveSandbox(sb)
    })

    expect(markup).toContain("sandbox-selector")
    expect(markup).toContain("main checkout")
  })

  it("renders dropdown items for each sandbox", () => {
    const sb1 = makeSandbox("sb-1", "proj-1", { displayName: "main checkout" })
    const sb2 = makeSandbox("sb-2", "proj-1", {
      displayName: "feature branch",
      sandboxType: "thread_sandbox",
      isMainCheckout: false,
    })

    const markup = renderSelector((store) => {
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setSandboxes([sb1, sb2])
      store.getState().actions.setActiveSandbox(sb1)
    })

    expect(markup).toContain("main checkout")
    expect(markup).toContain("feature branch")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/sandbox/sandbox-selector.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/desktop/src/renderer/src/sandbox/SandboxSelector.tsx`:

```typescript
import { useEffect, useRef, useState } from "react"

import { useAppStore } from "../state/app-store.js"
import { switchSandbox } from "./sandbox-workflows.js"

export function SandboxSelector() {
  const activeProjectId = useAppStore((s) => s.app.activeProjectId)
  const activeSandbox = useAppStore((s) => s.sandbox.activeSandbox)
  const sandboxes = useAppStore((s) => s.sandbox.sandboxes)
  const fetchStatus = useAppStore((s) => s.sandbox.sandboxFetchStatus)
  const actions = useAppStore((s) => s.actions)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [open])

  if (!activeProjectId) return null

  if (fetchStatus === "loading") {
    return (
      <div className="sandbox-selector">
        <span className="sandbox-selector__pill">…</span>
      </div>
    )
  }

  if (sandboxes.length === 0) return null

  const displayName = activeSandbox?.displayName ?? "unknown"

  function handleSelect(sandboxId: string) {
    if (!activeProjectId) return
    setOpen(false)
    void switchSandbox(activeProjectId, sandboxId, actions)
  }

  return (
    <div className="sandbox-selector" ref={ref}>
      <button
        className="sandbox-selector__pill"
        type="button"
        onClick={() => setOpen(!open)}
      >
        {displayName}
        <span className="sandbox-selector__chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="sandbox-selector__dropdown">
          {sandboxes.map((sb) => (
            <button
              key={sb.sandboxId}
              className={`sandbox-selector__item ${sb.sandboxId === activeSandbox?.sandboxId ? "sandbox-selector__item--active" : ""}`}
              type="button"
              onClick={() => handleSelect(sb.sandboxId)}
            >
              <span className="sandbox-selector__item-name">{sb.displayName}</span>
              <span className="sandbox-selector__item-type">
                {sb.isMainCheckout ? "main" : "thread"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/src/sandbox/sandbox-selector.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/sandbox/SandboxSelector.tsx apps/desktop/src/renderer/src/sandbox/sandbox-selector.test.tsx
git commit -m "feat(sandbox): add SandboxSelector pill and dropdown component"
```

---

### Task 9: Wire SandboxSelector into TitleBar and add hydration

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/TitleBar.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AppShell.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Modify: `apps/desktop/src/renderer/src/app-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `describe("AppShell")` in `app-shell.test.tsx` (import `makeSandbox` is already present from Task 6):

```typescript
it("renders the sandbox selector in the title bar", () => {
  const store = createAppStore()
  const sb = makeSandbox("sb-1", "proj-1", { displayName: "main checkout" })
  store.getState().actions.setActiveProjectId("proj-1")
  store.getState().actions.setSandboxes([sb])
  store.getState().actions.setActiveSandbox(sb)
  const currentState = store.getState()
  store.getInitialState = () => currentState
  const markup = renderToStaticMarkup(
    <AppStoreProvider store={store}>
      <AppShell />
    </AppStoreProvider>,
  )

  expect(markup).toContain("sandbox-selector")
  expect(markup).toContain("main checkout")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/src/app-shell.test.tsx`
Expected: FAIL

- [ ] **Step 3: Add SandboxSelector as a child of TitleBar in AppShell**

In `apps/desktop/src/renderer/src/components/AppShell.tsx`, add the import and render the selector inside TitleBar:

```typescript
import { SandboxSelector } from "../sandbox/SandboxSelector.js"
```

Update the TitleBar usage in the JSX:
```typescript
<TitleBar
  terminalOpen={app.terminalDrawerOpen}
  onToggleTerminal={() => actions.toggleTerminalDrawer()}
>
  <SandboxSelector />
</TitleBar>
```

Add sandbox hydration effect (after the existing project hydration effect):

```typescript
useEffect(() => {
  if (!app.activeProjectId || !canOpenProjects) return

  void hydrateSandboxes(app.activeProjectId, actions).catch(() => undefined)
}, [actions, app.activeProjectId, canOpenProjects])
```

Add the import:
```typescript
import { hydrateSandboxes } from "../sandbox/sandbox-workflows.js"
```

- [ ] **Step 4: Add sandbox selector CSS**

Add to `apps/desktop/src/renderer/src/styles/app.css`:

```css
/* ── Sandbox Selector ────────────────────────────────────── */

.sandbox-selector {
  position: relative;
}

.sandbox-selector__pill {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 5px;
  background: rgba(148, 163, 200, 0.08);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
}

.sandbox-selector__pill:hover {
  background: rgba(148, 163, 200, 0.14);
  color: var(--text-secondary);
}

.sandbox-selector__chevron {
  font-size: 0.6rem;
  color: var(--text-muted);
}

.sandbox-selector__dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 180px;
  background: var(--surface-2);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 200;
}

.sandbox-selector__item {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  text-align: left;
}

.sandbox-selector__item:hover {
  background: rgba(148, 163, 200, 0.08);
}

.sandbox-selector__item--active {
  color: var(--text-primary);
}

.sandbox-selector__item-type {
  font-size: 0.66rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/AppShell.tsx apps/desktop/src/renderer/src/components/TitleBar.tsx apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "feat(sandbox): wire SandboxSelector into title bar with hydration"
```

