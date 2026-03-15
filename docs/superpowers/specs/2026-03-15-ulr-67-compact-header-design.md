# ULR-67: Tighten App Shell Responsiveness and Compact Header Layout

**Date:** 2026-03-15
**Status:** Approved
**Linear:** ULR-67

## Objective

Make the top-level Ultra shell usable in narrower desktop windows by moving all navigation into the Electron title bar, eliminating the dedicated header row, and maximizing vertical space for page content.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Header layout | Single title bar row, never stacks | Maximizes vertical content space; title bars don't stack |
| Title bar integration | `titleBarStyle: 'hidden'` | Battle-tested (Claude Desktop, VS Code, Slack); full layout control |
| Project selector | Compact dropdown trigger pill | Minimal footprint; full details in popover on click |
| TopNav position | Centered in title bar | Visually balanced; matches Claude Desktop's pattern |
| RuntimeIndicator | Removed entirely | Debugging aid only; not needed in normal usage |
| No-project state | Same trigger pill, "Open Project" label | Consistent interaction pattern regardless of state |
| Responsive strategy | Progressive compacting, never stacking | Elements shrink/truncate but title bar stays one row |

## Architecture

### Layout Structure

```
┌──────────────────────────────────────────────┐
│  ●●● [my-project ▾]  [ Chat Editor Browser ]│  ← title bar (draggable, ~38-40px)
├──────────────────────────────────────────────┤
│                                              │
│              page content                    │
│              (gains ~60px vertical space)     │
│                                              │
└──────────────────────────────────────────────┘
```

### Title Bar Grid

```
grid-template-columns: auto 1fr auto
```

- **Left column:** macOS traffic light inset (70px) + ProjectSelector pill
- **Center column:** TopNav pills (centered via `justify-items: center`)
- **Right column:** Empty spacer matching left column width for true centering

### Drag Regions

- Title bar container: `-webkit-app-region: drag`
- ProjectSelector pill: `-webkit-app-region: no-drag`
- TopNav pills: `-webkit-app-region: no-drag`

## Component Changes

### New: `TitleBar`

Replaces the `<header className="app-shell__header">` in AppShell.

- Renders in the title bar area with macOS traffic light inset (~70px padding-left)
- Contains: ProjectSelector (left), TopNav (center), spacer (right)
- All content vertically centered, single row, ~38-40px height
- Entire area is a drag region except interactive elements

### New: `ProjectSelector`

Replaces `ProjectFrame` entirely.

**Trigger (always visible):**
- Compact pill button: project name + chevron (▾)
- When no project active: "Open Project" + chevron
- `-webkit-app-region: no-drag` so it's clickable

**Popover (on click):**
- Opens below trigger, left-aligned, ~8px gap
- Max-width: 320px
- Styled with surface-2 background, surface-border, shadow-lg

**Popover contents (project active):**
```
┌─────────────────────────┐
│ my-project              │  ← project name (bold)
│ ~/Projects/my-project   │  ← full path (muted)
│ repo: my-project (main) │  ← repo root (muted, smaller)
├─────────────────────────┤
│ RECENT                  │  ← section label
│ other-project           │  ← clickable, calls openProjectFromPath
│   ~/Projects/other-proj │
│ api-service             │
│   ~/Projects/api-svc    │
├─────────────────────────┤
│ Open Project...         │  ← calls openProjectFromPicker
└─────────────────────────┘
```

**Popover contents (no project):**
```
┌─────────────────────────┐
│ No project open         │
├─────────────────────────┤
│ RECENT                  │
│ (recent projects list)  │
├─────────────────────────┤
│ Open Project...         │
└─────────────────────────┘
```

**Popover behavior:**
- Opens on click of trigger pill
- Closes on: click outside, Escape key, selecting a project
- Error messages display inline in popover (same as current ProjectFrame)
- Open/closed state is local component state (useState)

**State:** No new store state. Reads from existing Zustand store:
- `activeProject` for current project info
- `projects.allIds`/`projects.byId` for recent projects
- Calls existing workflow functions: `openProjectFromPicker`, `openProjectFromPath`

### Modified: `TopNav`

No structural changes. Minor CSS adjustment:
- Slightly smaller padding to fit title bar height (current 8px 12px → 6px 10px)
- Component logic unchanged

### Modified: `AppShell`

- Remove `<header className="app-shell__header">` section
- Replace with `<TitleBar />`
- Body section becomes the only content below the title bar
- Grid changes from `grid-template-rows: auto minmax(0, 1fr)` to just the body

### Deleted: `RuntimeIndicator`

- Delete component file: `RuntimeIndicator.tsx`
- Remove all imports and references from `AppShell.tsx`
- Remove all CSS rules from `app.css`

### Modified: Electron `BrowserWindow` config

In the main process window creation:
- Add `titleBarStyle: 'hidden'` to BrowserWindow options
- Add `trafficLightPosition: { x: 16, y: 12 }` for macOS positioning

## CSS Changes

### Removed

- `.app-shell__header` — 3-column grid layout
- `.app-shell__nav-wrap` — center wrapper
- `.project-frame` and all sub-selectors (eyebrow, path, recent buttons, title row, etc.)
- `.runtime-indicator` and all sub-selectors (label, pill, dot, status colors)
- `@media (max-width: 1200px)` block for header stacking

### Added

- `.title-bar` — drag region container, grid layout, fixed ~38-40px height
- `.project-selector` — trigger pill styling
- `.project-selector__trigger` — pill button (background, border-radius, padding)
- `.project-selector__popover` — dropdown panel (positioned, themed)
- `.project-selector__popover-item` — clickable items in popover

### Responsive Breakpoints

**Wide (>900px):**
- Project name visible in trigger pill
- Full-size nav pills (6px 10px padding)

**Medium (≤900px):**
- Nav pills get tighter padding (6px 10px → 4px 8px)
- Project name truncates with ellipsis (max-width on trigger)

**Very narrow (≤600px):**
- Project selector shows just a folder icon (no text)
- Nav pills use compact padding

**Key principle:** The title bar never grows taller than one row. Elements shrink and truncate but never wrap or stack.

## Testing Strategy

### Unit Tests

**ProjectSelector:**
- Renders trigger with project name when project active
- Renders "Open Project" trigger when no project active
- Opens popover on click
- Closes popover on click outside / Escape
- Calls `openProjectFromPicker` when "Open Project..." clicked
- Calls `openProjectFromPath` when recent project clicked
- Closes popover after project selection
- Shows error state inline in popover

**TitleBar:**
- Renders ProjectSelector and TopNav
- Applies drag region class to container

### Existing Tests to Update

- `AppShell` tests: remove RuntimeIndicator expectations, update header → TitleBar
- `TopNav` tests: should pass with minimal CSS changes (no structural changes)

### Manual Verification

- Window dragging works on title bar area (not on interactive elements)
- Traffic lights positioned correctly on macOS
- Popover opens/closes correctly
- Nav pills remain centered at all window widths
- Progressive compacting at 900px and 600px breakpoints
- No vertical stacking at any width

## Scope Boundaries

**In scope:**
- Title bar integration with custom content
- ProjectSelector component (trigger + popover)
- RuntimeIndicator removal
- CSS cleanup and responsive refinement
- Electron BrowserWindow config change

**Out of scope:**
- Chat/Editor/Browser page shell layout changes (content area layouts unchanged)
- Backend changes (none needed)
- New store state or IPC contracts
- Mobile/tablet layouts (desktop-first, sensible degradation only)
