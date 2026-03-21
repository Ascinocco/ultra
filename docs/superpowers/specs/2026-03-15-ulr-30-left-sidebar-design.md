# ULR-30: Left Sidebar Design

## Status

Approved design — ready for implementation planning.

## Summary

Replace the placeholder chat rail in `ChatPageShell` with a Codex-inspired single-column sidebar containing multi-project navigation and per-project chat lists.

## Related

- [ULR-30 (Linear)](https://linear.app/ulra-agentic-ide/issue/ULR-30/build-multi-project-sidebar-sandbox-selector-and-terminal-drawer-shell)
- [ui-layout-and-navigation.md](/docs/ui-layout-and-navigation.md)
- [product-spec.md](/docs/product-spec.md)
- [ULR-79: Chat attention badges and system notifications](https://linear.app/ulra-agentic-ide/issue/ULR-79/add-chat-attention-badges-and-system-notifications) — tracked separately, out of scope

## Scope

This spec covers the left sidebar only — the first deliverable of ULR-30. Sandbox selector and terminal drawer are separate follow-ups.

### In scope

- Project list with collapsible groups
- Per-project chat list with pinned-first ordering
- New Chat action
- Chat context menu (rename, pin/unpin, archive)
- Active chat selection
- Settings entry point
- Zustand state additions for sidebar

### Out of scope

- Sandbox selector (depends on `sandboxes.*` IPC from backend)
- Terminal drawer (separate deliverable)
- Chat attention badges and system notifications (ULR-79)
- Changes to `packages/shared` contracts
- Changes to main process or backend
- Changes to center pane, right pane, or TitleBar

## Design

### Layout

Single-column sidebar, 280px wide, inside the existing `chat-frame__rail` region of `ChatPageShell`. Three zones:

**Top zone (fixed):**
- "New Chat" action button — creates a chat in the currently active project

**Middle zone (scrollable):**
- "Projects" section label
- Collapsible project groups

**Bottom zone (fixed):**
- Settings entry point, anchored to bottom of sidebar

### Project Groups

Each project renders as a collapsible row:

- Modern SVG folder icon (not emoji) + project display name + expand/collapse chevron
- Clicking the row toggles expand/collapse
- Multiple projects can be expanded simultaneously
- Expanding a project fetches its chat list via `chats.list` if not already loaded

### Chat List

Within an expanded project, chats are displayed as a flat list:

**Ordering:**
1. Pinned chats first (with a small pin indicator icon)
2. Remaining chats sorted by `updatedAt` descending (most recent first)

**Each chat row shows:**
- Chat title (truncated with ellipsis)
- Relative timestamp (e.g., "2m", "1h", "3d")

**Active chat:**
- The currently selected chat has a subtle highlight background
- Clicking a chat row sets it as the active chat

**Context menu (right-click):**
- Rename — prompts for new title, calls `chats.rename`
- Pin / Unpin — toggles pin state, calls `chats.pin` or `chats.unpin`
- Archive — calls `chats.archive`

No hover-reveal buttons. Context menu only.

### Data Flow

All required IPC query and command contracts already exist. There is no `chats.updated` subscription event yet, so the sidebar uses **optimistic local updates** from command responses rather than relying on a push subscription.

| Action | IPC method | Type |
|---|---|---|
| List projects | `projects.list` | query |
| Project updates | `projects.updated` | subscription |
| List chats for project | `chats.list` | query |
| Create chat | `chats.create` | command |
| Rename chat | `chats.rename` | command |
| Pin chat | `chats.pin` | command |
| Unpin chat | `chats.unpin` | command |
| Archive chat | `chats.archive` | command |
| Set active chat | `projects.set_layout` | command (via `setLayoutField`) |

**Optimistic update pattern:** When a chat command succeeds, the response contains the updated `ChatSnapshot`. The sidebar applies it to local state immediately via `upsertChat` (or `removeChat` for archive). This avoids the need for a `chats.updated` subscription in v1. If a command fails, the sidebar should re-fetch via `chats.list` to reconcile.

### State Additions

Add a new `sidebar` slice to the Zustand store, following the existing slice pattern (`app`, `readiness`, `projects`, `layout`):

```typescript
type SidebarSlice = {
  expandedProjectIds: string[]        // array, not Set — matches existing store patterns
  chatsByProjectId: Record<string, ChatSummary[]>
  chatsFetchStatus: Record<string, 'idle' | 'loading' | 'error'>
}
```

New actions (added to `AppActions`):

```typescript
toggleProjectExpanded: (projectId: string) => void
setChatsForProject: (projectId: string, chats: ChatSummary[]) => void
setChatsFetchStatus: (projectId: string, status: 'idle' | 'loading' | 'error') => void
upsertChat: (chat: ChatSummary) => void   // called with command response after create/rename/pin/unpin
removeChat: (chatId: string, projectId: string) => void   // called after archive
```

### Active Chat Selection

Selecting a chat calls `setLayoutField(projectId, { activeChatId: chatId })`, which already exists and debounce-persists to the backend.

When a project is first expanded and has a persisted `activeChatId` in layout state, that chat should be visually highlighted.

### Component Structure

```
ChatPageShell
  └── Sidebar
        ├── SidebarHeader        — "New Chat" button
        ├── SidebarProjectList   — scrollable project groups
        │     └── ProjectGroup   — one per project
        │           ├── ProjectRow      — folder icon + name + chevron
        │           └── ChatList        — rendered when expanded
        │                 └── ChatRow   — title + timestamp + active highlight
        ├── ChatContextMenu      — rename / pin / archive
        └── SidebarFooter        — Settings
```

### Styling

Follow existing patterns:
- CSS custom properties from `tokens.css`
- BEM-style class naming (e.g., `sidebar__header`, `project-group__row`)
- Dark theme only
- No Tailwind, no CSS-in-JS
- Hover states use `rgba(148, 163, 200, 0.08)` pattern from existing code
- Active states use `rgba(91, 141, 239, 0.08)` pattern from existing code

### Responsive

At the existing 900px breakpoint, the current CSS collapses `chat-frame__grid` to `grid-template-columns: 1fr`, which stacks the rail vertically above the main content. For the sidebar, add `display: none` on `.chat-frame__rail` at the breakpoint instead — the sidebar is not useful at narrow widths and the `ProjectSelector` in the TitleBar remains available as fallback navigation.

### Loading and Empty States

**Loading:** When a project is expanded and its chats are being fetched, show a subtle loading indicator (e.g., "Loading..." text or skeleton rows) inside the project group.

**Empty:** When a project has no chats, show "No chats yet" with a prompt to use "New Chat".

**Error:** If `chats.list` fails, show a brief inline error with a "Retry" action inside the project group.

**New Chat disabled state:** The "New Chat" button is disabled when no project is active (`activeProjectId` is null).

### Keyboard Accessibility

- Project rows and chat rows are focusable via Tab
- Enter or Space toggles project expand/collapse
- Enter or Space on a chat row selects it as active
- Context menu opens via Shift+F10 or the Menu key on focused chat rows
- Arrow keys navigate within the chat list
- Escape closes the context menu

## Decisions

1. Single-column Codex-style sidebar (not two-tier strip)
2. Multiple projects can be expanded simultaneously
3. Pinned chats sort first, then by recency — no labeled sub-sections
4. Context menu only for chat actions (no hover-reveal buttons)
5. Modern SVG folder icon (not emoji)
6. No changes to shared contracts or backend
7. Chat attention badges tracked separately as ULR-79
