# ULR-100: Chat Input Dock Redesign

## Status

Design — approved, pending implementation.

## Objective

Redesign the chat input area to match the Codex CLI aesthetic: a single rounded container with inline toolbar pills for model, thinking level, and permissions. Add file attachment support with drag-and-drop. Runtime config persists as read-only pills after the first turn.

## Context

The current input dock has a separate "Runtime for first turn" section with labeled dropdowns that disappears after the first message. The textarea and Send button are bare-bones. The redesign consolidates everything into a compact, polished input container.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Single rounded container, no separate sections | Cleaner, matches Codex |
| Model pill | Model name only, provider inferred | One less control, model names are unambiguous |
| Thinking & permissions | Dropdown menus (not cycle-through) | More discoverable, clearer options |
| After first turn | Pills become read-only (greyed, no dropdown) | Config locked after conversation starts |
| File attachment | `+` button + drag-and-drop | Standard pattern |
| Send button | Circular ↑ arrow | Matches Codex, cleaner than text "Send" |
| Bottom info bar | Removed | Permissions in toolbar, sandbox handled elsewhere |
| Backend | No changes | Existing APIs sufficient |

## Component Structure

### InputDock (replaces current input form)

**File:** `apps/desktop/src/renderer/src/chats/input-dock/InputDock.tsx`

The main container. Renders:
1. Textarea (auto-growing, borderless)
2. File attachment badges (when files attached)
3. Toolbar row with pills and send button
4. Drag-and-drop overlay (when dragging)

**Props:**
```ts
type InputDockProps = {
  chatId: string
  disabled: boolean           // true when turn is in-flight
  isFirstTurn: boolean        // controls whether pills are editable
  provider: string            // current provider
  model: string               // current model
  thinkingLevel: string       // current thinking level
  permissionLevel: string     // "full_access" | "supervised"
  availableModels: string[]   // models for current provider
  onSend: (prompt: string, attachments: File[]) => void
  onRuntimeConfigChange: (config: { provider?: string; model?: string; thinkingLevel?: string; permissionLevel?: string }) => void
}
```

### ToolbarPill (reusable dropdown pill)

**File:** `apps/desktop/src/renderer/src/chats/input-dock/ToolbarPill.tsx`

A small pill button that opens a dropdown menu on click.

**Props:**
```ts
type ToolbarPillProps = {
  label: string               // display text
  icon?: string               // optional leading icon/emoji
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
  readOnly?: boolean          // greyed out, no dropdown
}
```

**States:**
- **Editable:** colored text, dropdown arrow, clickable
- **Read-only:** muted text, no arrow, not clickable
- **Open:** shows dropdown menu below the pill

### FileAttachmentBar

**File:** `apps/desktop/src/renderer/src/chats/input-dock/FileAttachmentBar.tsx`

Renders file preview badges. Each badge shows file icon + name + ✕ remove button.

**Props:**
```ts
type FileAttachmentBarProps = {
  files: File[]
  onRemove: (index: number) => void
}
```

### InputDock CSS

**File:** `apps/desktop/src/renderer/src/chats/input-dock/input-dock.css`

Uses design tokens. Key classes:
- `.input-dock` — rounded container with `--surface-1` background, `--surface-border` border
- `.input-dock__textarea` — borderless, transparent background, auto-grow
- `.input-dock__toolbar` — flex row with gap
- `.input-dock__pill` — small rounded pill with icon + text + optional dropdown arrow
- `.input-dock__pill--readonly` — muted color, no arrow
- `.input-dock__pill-menu` — absolute-positioned dropdown below pill
- `.input-dock__send` — circular button, `--text-primary` background
- `.input-dock__send--disabled` — reduced opacity
- `.input-dock__attach` — bordered icon button
- `.input-dock__file-bar` — flex-wrap row for file badges
- `.input-dock__file-badge` — small rounded badge with icon + name + remove
- `.input-dock__drop-overlay` — dashed blue border, centered text

## Textarea Behavior

- **Auto-grow:** textarea starts at ~2 lines, grows as content is added, caps at ~8 lines then scrolls
- **Submit on Enter:** Enter sends the message (like Codex). Shift+Enter for newline.
- **Disabled state:** when `disabled` is true (turn in-flight), textarea is read-only, pills are inactive, send button shows a spinner or is disabled

## Dropdown Menus

Each pill's dropdown is a simple absolute-positioned menu:
- Appears below the pill on click
- Closes on selection or click-outside
- Shows current selection with a checkmark
- Options:
  - **Model:** list of `availableModels` from the chat's provider
  - **Thinking:** `["low", "normal", "high", "max"]` (or `["default", "low", "medium", "high", "max"]` per the schema)
  - **Permissions:** `[{ value: "full_access", label: "Full access" }, { value: "supervised", label: "Supervised" }]`

## File Attachment

**Attach button (`+`):**
- Opens native file picker (`<input type="file" multiple>`)
- Accepted types: images (png, jpg, gif, webp), text files, PDFs
- Selected files appear as badges between textarea and toolbar

**Drag-and-drop:**
- `onDragOver` / `onDrop` on the InputDock container
- While dragging over: show dashed blue border overlay with "Drop files here"
- On drop: add files to the attachment list

**File badges:**
- Show file type icon (🖼 for images, 📄 for text/PDF)
- Truncated filename
- ✕ button to remove

**Sending with attachments:**
- `onSend` receives both `prompt` and `attachments: File[]`
- The backend/workflow handles encoding files for the provider (future: base64 for images)

## Integration in ChatPageShell

Replace the current `<form className="active-chat-pane__input-dock">` (lines 1085-1228) with:

```tsx
<InputDock
  chatId={activeChatId}
  disabled={chatInputDisabled}
  isFirstTurn={activeChatMessages.length === 0}
  provider={activeChat.provider}
  model={activeChat.model}
  thinkingLevel={activeChat.thinkingLevel}
  permissionLevel={activeChat.permissionLevel}
  availableModels={modelsForProvider}
  onSend={handleSend}
  onRuntimeConfigChange={handleRuntimeConfigChange}
/>
```

The `handleSend` function replaces the current `handleStartTurn`. The `handleRuntimeConfigChange` calls the existing `updateChatRuntimeConfig` workflow.

## File Summary

**Create:**

| File | Purpose |
|------|---------|
| `apps/desktop/src/renderer/src/chats/input-dock/InputDock.tsx` | Main input container |
| `apps/desktop/src/renderer/src/chats/input-dock/ToolbarPill.tsx` | Reusable dropdown pill |
| `apps/desktop/src/renderer/src/chats/input-dock/FileAttachmentBar.tsx` | File badge row |
| `apps/desktop/src/renderer/src/chats/input-dock/input-dock.css` | All input dock styles |

**Modify:**

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Replace input form with `InputDock` component |
| `apps/desktop/src/renderer/src/styles/app.css` | Remove old `.active-chat-pane__input-dock` and related styles |

## Testing

- **ToolbarPill:** render tests for editable/read-only states, dropdown open/close, selection
- **FileAttachmentBar:** render tests for file badges, remove button
- **InputDock:** render tests for first-turn vs after-turn states, disabled state
- **Integration:** verify in ChatPageShell that send works, runtime config changes propagate

## Out of Scope

- Voice input (ULR-22 — placeholder button only)
- Actually sending file attachments to the backend (the UI collects files; the backend wiring is a separate ticket)
- Provider switching mid-conversation
- Keyboard shortcuts beyond Enter to send

## References

- Codex CLI input area (reference screenshots)
- `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx:1085-1228` (current input)
- `apps/desktop/src/renderer/src/styles/app.css:747-873` (current styles)
