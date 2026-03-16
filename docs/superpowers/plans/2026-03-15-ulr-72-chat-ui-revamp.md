# ULR-72: Chat UI Revamp Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat page to use connected panel borders in a single outer frame with flat surfaces — no gradients, no floating card shadows — inspired by Claude Desktop's clean pane layout.

**Architecture:** Replace the current floating-cards-with-gaps model with a single outer container that has rounded corners on the outside and thin internal dividers between panes. Remove all gradients from tokens and surfaces. Remove box-shadows from non-floating elements. The chat layout grid changes from `gap: 20px` with individual rounded surfaces to `gap: 0` with shared 1px borders between panels. Only popovers/modals retain shadows.

**Tech Stack:** CSS (tokens.css, app.css), React (ChatPageShell.tsx), Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/desktop/src/renderer/src/styles/tokens.css` | Modify | Remove gradients, add flat bg, remove shadow from non-floating contexts |
| `apps/desktop/src/renderer/src/styles/app.css` | Modify | Rework `.surface`, `.chat-layout`, `.placeholder-card` styles; remove `.surface--rail` gradient; add `.chat-frame` outer container |
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Modify | Wrap chat-layout in `.chat-frame` container; remove `.surface` class from individual panels; use new panel class names |
| `apps/desktop/src/renderer/src/app-shell.test.tsx` | Modify | Update assertions for changed class names in chat layout |

**Not modified** (out of scope): `EditorPageShell.tsx`, `BrowserPageShell.tsx` — these are placeholder UIs that will be redesigned independently later. The `.surface` class remains available for them. The chat page will serve as the design pattern source of truth.

**Cross-cutting note:** Removing `box-shadow` from `.surface` and gradients from tokens affects Editor/Browser pages too. This is intentional — shadows and gradients are being removed app-wide as a design direction. The Editor/Browser layout structure is untouched; only their visual appearance becomes flatter.

---

## Chunk 1: Tokens and Surface Foundation

### Task 1: Flatten tokens — remove gradients and restrict shadows

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/tokens.css`
- Modify: `apps/desktop/src/renderer/src/styles/app.css` (body background, surface shadow)

- [ ] **Step 1: Write the failing test — body no longer uses gradient background**

In `apps/desktop/src/renderer/src/app-shell.test.tsx`, add a new test inside the `AppShell` describe block:

```tsx
it("does not render gradient class names in chat layout", () => {
  const markup = renderShell()

  expect(markup).not.toContain("surface--rail")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter desktop exec vitest run src/renderer/src/app-shell.test.tsx`
Expected: FAIL — ChatPageShell currently renders `surface--rail` on the aside.

- [ ] **Step 3: Update tokens.css and app.css body background together**

**Important:** Steps 3 and 4 must be applied together before running the app. Saving tokens.css alone (which removes `--shell-bg-accent`) without updating the body background in app.css will cause a blank background. Apply both files, then verify.

**First, update tokens.css** — replace gradients with flat values:

Replace the full contents of `apps/desktop/src/renderer/src/styles/tokens.css` with:

```css
:root {
  color-scheme: dark;

  /* Flat dark shell */
  --shell-bg: #0f1117;

  /* Blue-tinted surfaces */
  --surface-1: rgba(16, 19, 28, 0.95);
  --surface-2: rgba(22, 26, 38, 0.92);
  --surface-3: rgba(28, 33, 46, 0.94);
  --surface-border: rgba(148, 163, 200, 0.1);

  /* Panel border — slightly stronger than surface-border for internal dividers */
  --panel-border: rgba(148, 163, 200, 0.14);

  /* Cool blue-white text */
  --text-primary: #eef1f8;
  --text-secondary: #b0bbd0;
  --text-muted: #6b7a94;

  /* Blue accent */
  --accent: #5b8def;
  --accent-strong: #7aa5ff;
  --accent-surface: rgba(91, 141, 239, 0.12);

  /* Status colors */
  --success: #6ee7b7;
  --warning: #facc15;
  --danger: #fb7185;
  --idle: #6b7a94;

  /* Shadows — reserved for floating elements only (popovers, modals) */
  --shadow-lg: 0 24px 64px rgba(4, 6, 14, 0.5);
  --shadow-md: 0 12px 32px rgba(4, 6, 14, 0.35);

  /* Rounded corners */
  --radius-xl: 16px;
  --radius-lg: 12px;
  --radius-md: 8px;
}
```

Changes from current:
- Removed `--shell-bg-accent` (gradient) entirely
- Added `--panel-border` token for internal dividers (slightly stronger than `--surface-border`)
- Comments clarify shadows are for floating elements only

- [ ] **Step 4: Update app.css body background and surface shadows**

In `apps/desktop/src/renderer/src/styles/app.css`:

Replace body background:
```css
body {
  margin: 0;
  background: var(--shell-bg);
  color: var(--text-primary);
  font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
  font-size: 15px;
  line-height: 1.6;
}
```

Replace the `.surface` block — remove shadow and keep border-radius (still used by Editor/Browser pages):
```css
.surface {
  background: var(--surface-2);
  border-radius: var(--radius-xl);
  border: 1px solid var(--surface-border);
  padding: 20px;
  box-sizing: border-box;
}
```

Remove the `.surface--rail` block entirely (delete lines 510-519):
```css
/* DELETE THIS ENTIRE BLOCK: */
.surface--rail {
  background:
    radial-gradient(
      ellipse at top left,
      rgba(70, 90, 160, 0.12),
      transparent 60%
    ),
    radial-gradient(ellipse at bottom, rgba(60, 70, 130, 0.06), transparent 50%),
    rgba(18, 22, 34, 0.96);
}
```

Update `.project-selector__popover` to explicitly keep its shadow (it's a floating element):
```css
.project-selector__popover {
  /* ... existing properties ... */
  box-shadow: var(--shadow-lg);  /* keep — floating element */
}
```

Update `.top-nav` to remove its shadow:
```css
.top-nav {
  display: inline-grid;
  grid-auto-flow: column;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--surface-border);
  -webkit-app-region: no-drag;
}
```

Update `.system-tools-panel__overlay` — keep shadow (it's a modal overlay):
No change needed — it uses `background` not `box-shadow`.

Update `.readiness-gate__card, .foundation-startup-gate__card, .system-tools-panel` — remove shadow (these are page-level, not floating):
```css
.readiness-gate__card,
.foundation-startup-gate__card,
.system-tools-panel {
  width: min(900px, 100%);
  background: var(--surface-2);
  border: 1px solid var(--surface-border);
  padding: 24px;
  box-sizing: border-box;
}
```

- [ ] **Step 5: Update ChatPageShell.tsx — remove surface--rail class**

In `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`, line 9, change:
```tsx
<aside className="surface surface--rail">
```
to:
```tsx
<aside className="surface">
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter desktop exec vitest run src/renderer/src/app-shell.test.tsx`
Expected: All tests PASS (including new gradient assertion)

- [ ] **Step 7: Run lint**

Run: `pnpm --filter desktop run lint`
Expected: Clean

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/tokens.css \
        apps/desktop/src/renderer/src/styles/app.css \
        apps/desktop/src/renderer/src/pages/ChatPageShell.tsx \
        apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "style: flatten tokens, remove gradients and non-floating shadows"
```

---

## Chunk 2: Chat Frame and Connected Panels

### Task 2: Add chat-frame outer container and connected panel CSS

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`
- Modify: `apps/desktop/src/renderer/src/app-shell.test.tsx`

The chat layout currently looks like this:
```
┌─────────┐  ┌────────────────┐  ┌──────────┐
│ Rail     │  │ Active Chat    │  │ Threads  │
│ (aside)  │  │                │  │          │
│          │  │                │  ├──────────┤
│          │  │                │  │ Status   │
└─────────┘  └────────────────┘  └──────────┘
   gap=20      gap=20              gap=20
```

Target layout — one outer frame, panels share borders:
```
┌──────────┬────────────────┬──────────┐
│ Rail     │ Active Chat    │ Threads  │
│ (aside)  │                │          │
│          │           ↔    │          │
│          │        (drag)  │          │
└──────────┴────────────────┴──────────┘
```

**Note (2026-03-16):** The status pane (`chat-frame__side-bottom`) has been removed. The right column is now a single full-height thread pane. A vertical drag handle between chat and thread panes allows resizing. The sidebar is collapsible via a title bar toggle. See layout refinement spec for details.

- [ ] **Step 1: Write failing tests for the new chat frame structure**

In `apps/desktop/src/renderer/src/app-shell.test.tsx`, add inside the `AppShell` describe block:

```tsx
it("wraps the chat layout in a chat-frame container", () => {
  const markup = renderShell()

  expect(markup).toContain("chat-frame")
  expect(markup).toContain("chat-frame__grid")
  expect(markup).toContain("chat-frame__rail")
  expect(markup).toContain("chat-frame__main")
  expect(markup).toContain("chat-frame__side")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter desktop exec vitest run src/renderer/src/app-shell.test.tsx`
Expected: FAIL — markup does not contain `chat-frame`.

- [ ] **Step 3: Add chat-frame CSS to app.css**

Add after the existing `/* ── Layout Grids */` section. Replace the existing `.chat-layout` rules with:

```css
/* ── Chat Frame (connected-panel layout) ─────────────────── */

.chat-frame {
  background: var(--surface-2);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  min-height: 100%;
}

.chat-frame__grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) minmax(320px, 0.95fr);
  min-height: 100%;
}

.chat-frame__rail {
  padding: 20px;
  border-right: 1px solid var(--panel-border);
  background: var(--surface-1);
}

.chat-frame__main {
  padding: 20px;
  border-right: 1px solid var(--panel-border);
}

.chat-frame__side {
  display: flex;
  flex-direction: column;
  padding: 20px;
}

/* Note (2026-03-16): .chat-frame__side-top and .chat-frame__side-bottom
   have been removed. The right column is now a single full-height thread pane.
   See layout refinement spec for the updated structure. */
```

Delete the old chat-specific layout rules. **Important:** There is a shared selector on lines 462–466 that combines `.chat-layout` with `.editor-layout` and `.browser-layout`. Only remove `.chat-layout,` from that selector — do NOT delete the entire block or the Editor/Browser min-height breaks.

**Edit the shared selector** (lines 462–466 of current app.css):
```css
/* BEFORE: */
.chat-layout,
.editor-layout,
.browser-layout {
  min-height: 100%;
}

/* AFTER — remove only .chat-layout from the selector: */
.editor-layout,
.browser-layout {
  min-height: 100%;
}
```

**Delete these three standalone blocks entirely:**

```css
/* DELETE — line ~468: */
.chat-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
}

/* DELETE — line ~474: */
.chat-layout__main {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.95fr);
  gap: 20px;
}

/* DELETE — line ~480: */
.chat-layout__side {
  display: grid;
  gap: 20px;
}
```

Also update the responsive breakpoint inside `@media (max-width: 900px)`. **Delete** the old `.chat-layout, .chat-layout__main` rule and **add** the new chat-frame responsive rules:

```css
@media (max-width: 900px) {
  .top-nav__pill {
    padding: 3px 7px;
    font-size: 0.72rem;
  }

  .project-selector__trigger {
    max-width: 120px;
  }

  /* DELETE the old rule:
  .chat-layout,
  .chat-layout__main {
    grid-template-columns: 1fr;
  }
  */

  /* ADD these new rules: */
  .chat-frame__grid {
    grid-template-columns: 1fr;
  }

  .chat-frame__rail {
    border-right: none;
    border-bottom: 1px solid var(--panel-border);
  }

  .chat-frame__main {
    border-right: none;
    border-bottom: 1px solid var(--panel-border);
  }

  .chat-frame__side {
    grid-template-rows: auto auto;
  }
}
```

- [ ] **Step 4: Rewrite ChatPageShell.tsx to use chat-frame structure**

Replace the full contents of `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`:

```tsx
export function ChatPageShell({ active }: { active: boolean }) {
  return (
    <section
      aria-hidden={!active}
      className={`page-shell ${active ? "page-shell--active" : "page-shell--hidden"}`}
      data-page="chat"
    >
      <div className="chat-frame">
        <div className="chat-frame__grid">
          <aside className="chat-frame__rail">
            <div className="surface__header">
              <p className="surface__eyebrow">Chat Rail</p>
              <h2 className="surface__title">Project chats</h2>
            </div>
            <div className="placeholder-card">
              <strong>No chats yet</strong>
              <p>
                This rail will hold pinned, active, and archived chats once chat
                persistence lands.
              </p>
            </div>
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
        </div>
      </div>
    </section>
  )
}
```

Key changes:
- Outer `.chat-frame` replaces `.chat-layout` — single rounded border container
- Three-column grid (`.chat-frame__grid`) instead of nested two-column grids
- No `.surface` class on individual panels — the frame IS the surface
- Panels use padding + `border-right`/`border-top` for internal dividers
- Rail uses `--surface-1` background (slightly darker) for visual differentiation without gradients

- [ ] **Step 5: Update existing test assertions for changed class names**

In `apps/desktop/src/renderer/src/app-shell.test.tsx`, the `"defaults to the Chat page"` test currently asserts `"No chats yet"` and `"Open Project"` — these still hold. But we need to verify no old class names leak through. No changes needed to existing tests since they check content, not layout class names.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter desktop exec vitest run src/renderer/src/app-shell.test.tsx`
Expected: All tests PASS

- [ ] **Step 7: Run typecheck and lint**

Run: `pnpm --filter desktop exec tsc --noEmit && pnpm --filter desktop run lint`
Expected: Clean

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css \
        apps/desktop/src/renderer/src/pages/ChatPageShell.tsx \
        apps/desktop/src/renderer/src/app-shell.test.tsx
git commit -m "feat: connected-panel chat frame replacing floating card layout"
```

---

## Chunk 3: Placeholder Card Cleanup and Final Verification

### Task 3: Update placeholder-card styling to fit inside connected panels

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

Placeholder cards currently have their own border, border-radius, and dark background — designed for floating inside rounded surfaces. Inside the connected frame, they should be simpler: just a subtle inset background with no border-radius (the frame handles the outer shape).

- [ ] **Step 1: Update placeholder-card CSS**

Replace the `.placeholder-card` block in `app.css`:

```css
.placeholder-card {
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 180px;
  padding: 16px;
  background: rgba(14, 17, 26, 0.4);
  border: 1px solid rgba(148, 163, 200, 0.06);
  border-radius: var(--radius-md);
}
```

Changes: reduced background opacity (less contrast inside an already-dark frame), smaller padding, smaller border-radius (subtle rounding, not floating-card rounding), softer border.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter desktop exec vitest run`
Expected: All 43+ tests PASS

- [ ] **Step 3: Run lint**

Run: `pnpm --filter desktop run lint`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "style: soften placeholder cards for connected-panel layout"
```

### Task 4: Full verification

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter desktop exec tsc --noEmit`
Expected: Clean

- [ ] **Step 2: Full test suite**

Run: `pnpm --filter desktop exec vitest run`
Expected: All tests PASS

- [ ] **Step 3: Lint**

Run: `pnpm --filter desktop run lint`
Expected: Clean

- [ ] **Step 4: Visual audit checklist**

Launch the app and verify:
- [ ] Chat page: single outer rounded frame with no gaps between panels
- [ ] Rail | Main | Side panels share borders (thin 1px dividers)
- [ ] No gradients anywhere — flat solid backgrounds throughout
- [ ] No box-shadows on surfaces (only on project-selector popover)
- [ ] Rail has slightly darker background than main/side panels
- [ ] Side panel has horizontal divider between threads and status sections
- [ ] Responsive: at < 900px, panels stack vertically with horizontal dividers
- [ ] Editor and Browser pages still render correctly with existing `.surface` styling
- [ ] Top nav pills render without shadow
- [ ] Readiness gate / startup screens render without shadow
