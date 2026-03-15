# ULR-30: Terminal Drawer Shell & Sandbox Selector

## Summary

Complete the remaining ULR-30 scope by adding two UI shells to the chat workspace: a resizable terminal drawer that spans the bottom of the chat and threads columns, and a sandbox selector pill in the title bar.

Both are structural containers with placeholder content. The terminal drawer will be wired to real terminal sessions in ULR-31. The sandbox selector uses existing backend IPC contracts (`sandboxes.list`, `sandboxes.get_active`, `sandboxes.set_active`).

## Terminal Drawer

### Layout

The terminal drawer is a bottom panel that spans columns 2–3 of the `.chat-frame__grid` (chat + right-side pane), excluding the sidebar. When open, it compresses the chat and threads areas vertically. When closed, it disappears completely — no residual strip or handle.

### Toggle

Two ways to open/close:
- **Title bar icon:** A terminal icon button in the title bar, right-aligned, to the left of the sandbox selector pill. Styled with `-webkit-app-region: no-drag` so it's clickable within the drag region.
- **Keyboard shortcut:** `` Cmd+` `` on macOS, `` Ctrl+` `` on other platforms. Hardcoded for now; future work will make shortcuts user-configurable.

### Resize

A drag handle on the top edge of the drawer. The cursor changes to `row-resize` on hover. Constraints:
- **Minimum height:** 100px (enough for a few lines of output)
- **Maximum height:** 80% of the `.chat-frame` height

Height is stored in component state (not persisted to the layout slice).

### Components

**`TerminalDrawer`** — the shell container.
- Top edge: drag handle (thin bar, `row-resize` cursor)
- Header bar: "Terminal" label on the left, close button (×) on the right
- Content area: placeholder div for now (ULR-31 wires real terminal sessions)

Props:
- `height: number` — current drawer height in px
- `onResize: (height: number) => void` — called during drag
- `onClose: () => void` — called when × is clicked

### CSS

Change `.chat-frame__grid` to support an optional bottom row. Add explicit grid placement to all children so they behave correctly when the row count changes:

- `.chat-frame__rail`: add `grid-row: 1 / -1` (sidebar always spans all rows)
- `.chat-frame__main`: add `grid-row: 1` (pin to first row)
- `.chat-frame__side`: add `grid-row: 1` (pin to first row)
- Drawer open: `grid-template-rows: minmax(0, 1fr) <drawer-height>px`
- Drawer closed: `grid-template-rows: minmax(0, 1fr)` (current behavior)

The drawer element uses `grid-column: 2 / -1; grid-row: 2`.

**Responsive (max-width 900px):** The terminal drawer spans the single column (`grid-column: 1 / -1`) since the sidebar is hidden at this breakpoint.

### Store

Add to `AppSlice`:
- `terminalDrawerOpen: boolean` (default `false`)
- `toggleTerminalDrawer()` action

## Sandbox Selector

### Placement

A small pill/button in the title bar, right-aligned with margin (~12px) from the window edge. Sits to the right of the terminal toggle icon.

### Appearance

Shows the active sandbox display name (e.g. "main checkout" or a thread branch name) with a chevron (▾) indicating it's a dropdown. Uses muted text styling consistent with the title bar aesthetic. The pill and terminal icon both use `-webkit-app-region: no-drag`.

### Behavior

Clicking the pill opens a dropdown listing available sandboxes for the active project:
- Fetches sandbox list via `sandboxes.list` IPC query
- Each item shows sandbox name, type badge (main / thread), and branch name
- Selecting an item calls `sandboxes.set_active` IPC command, then updates the store on success (not optimistic — wait for the round-trip)
- Dropdown closes on selection, outside click, or Escape

### States

| State | Behavior |
|-------|----------|
| No active project | Selector is hidden |
| Loading sandboxes | Shows "..." placeholder in the pill |
| Active project, no sandboxes exist | Selector is hidden (same as no active project) |
| Single sandbox | Shown (user sees which checkout they're in), dropdown has one item |
| Multiple sandboxes | Full dropdown with all options |
| Fetch error | Shows last known sandbox name or "unknown" |

### Components

**`SandboxSelector`** — the pill button + dropdown.
- Receives `activeProjectId` from the store
- Fetches sandboxes when `activeProjectId` changes
- Renders dropdown items with sandbox metadata

### Store

Add a new `SandboxSlice` (consistent with existing slice-per-concern pattern):
- `activeSandbox: SandboxContextSnapshot | null` (default `null`)
- `sandboxes: SandboxContextSnapshot[]` (default `[]`)
- `sandboxFetchStatus: "idle" | "loading" | "error"` (default `"idle"`)

Actions:
- `setActiveSandbox(sandbox: SandboxContextSnapshot | null)`
- `setSandboxes(sandboxes: SandboxContextSnapshot[])`
- `setSandboxFetchStatus(status: "idle" | "loading" | "error")`

### Hydration

When `activeProjectId` changes, sandbox hydration runs from `AppShell.tsx` (same pattern as project hydration). It calls `hydrateSandboxes(projectId, actions)` from `sandbox-workflows.ts`, which:
1. Sets `sandboxFetchStatus` to `"loading"`
2. Calls `sandboxes.list` and `sandboxes.get_active` in parallel
3. On success: sets `sandboxes`, `activeSandbox`, and `sandboxFetchStatus` to `"idle"`
4. On error: sets `sandboxFetchStatus` to `"error"`, keeps last known `activeSandbox`

### Workflow Functions (`sandbox-workflows.ts`)

- `hydrateSandboxes(projectId: string, actions: Pick<AppActions, 'setSandboxes' | 'setActiveSandbox' | 'setSandboxFetchStatus'>)` — fetches sandbox list and active sandbox for a project
- `switchSandbox(projectId: string, sandboxId: string, actions: Pick<AppActions, 'setActiveSandbox'>)` — calls `sandboxes.set_active`, updates store on success

## Title Bar Changes

`TitleBar` currently renders an empty div. It will gain:
- A right-aligned flex container with `-webkit-app-region: no-drag`
- Terminal toggle icon button (left)
- Sandbox selector pill (right)
- Gap spacing between elements
- Margin from the right edge (~12px)

The rest of the title bar remains an empty drag region.

Props added to `TitleBar`:
- `terminalOpen: boolean`
- `onToggleTerminal: () => void`
- `activeProjectId: string | null`

## Files

### New files
- `apps/desktop/src/renderer/src/terminal/TerminalDrawer.tsx`
- `apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx`
- `apps/desktop/src/renderer/src/sandbox/SandboxSelector.tsx`
- `apps/desktop/src/renderer/src/sandbox/sandbox-selector.test.tsx`
- `apps/desktop/src/renderer/src/sandbox/sandbox-workflows.ts`
- `apps/desktop/src/renderer/src/sandbox/sandbox-workflows.test.ts`

### Modified files
- `apps/desktop/src/renderer/src/components/TitleBar.tsx` — add terminal icon + sandbox selector
- `apps/desktop/src/renderer/src/components/AppShell.tsx` — pass terminal/sandbox state, keyboard shortcut listener, sandbox hydration effect
- `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` — integrate TerminalDrawer into grid
- `apps/desktop/src/renderer/src/state/app-store.tsx` — add SandboxSlice, terminal drawer state + actions
- `apps/desktop/src/renderer/src/styles/app.css` — terminal drawer styles, title bar layout, grid placement rules

## Out of Scope

- Real terminal session management (ULR-31)
- Terminal command execution (ULR-33)
- Runtime profile and .env sync (ULR-32)
- Persisting drawer height across sessions
- User-configurable keyboard shortcuts
