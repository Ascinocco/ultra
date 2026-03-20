# ULR-100: Chat Input Dock Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-bones chat input with a Codex-style rounded container featuring inline toolbar pills for model, thinking level, permissions, file attachment, and a circular send button.

**Architecture:** A new `InputDock` component replaces the current form in ChatPageShell. It contains a borderless textarea, a `FileAttachmentBar` for file badges, and a toolbar row of `ToolbarPill` dropdown components. The existing `updateChatRuntimeConfig` workflow handles config changes; `startChatTurn` handles sending.

**Tech Stack:** React, TypeScript, CSS with design tokens, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-chat-input-dock-redesign.md`

---

## File Structure

**Create:**

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/renderer/src/chats/input-dock/ToolbarPill.tsx` | Reusable dropdown pill button |
| `apps/desktop/src/renderer/src/chats/input-dock/ToolbarPill.test.tsx` | Tests for pill states |
| `apps/desktop/src/renderer/src/chats/input-dock/FileAttachmentBar.tsx` | File badge row with remove buttons |
| `apps/desktop/src/renderer/src/chats/input-dock/InputDock.tsx` | Main input container |
| `apps/desktop/src/renderer/src/chats/input-dock/input-dock.css` | All input dock styles |

**Modify:**

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Replace input form (lines 1085-1228) with `InputDock` |
| `apps/desktop/src/renderer/src/styles/app.css` | Remove old `.active-chat-pane__input-dock` styles (lines 747-873) |

---

### Task 1: ToolbarPill Component

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/input-dock/ToolbarPill.tsx`
- Create: `apps/desktop/src/renderer/src/chats/input-dock/ToolbarPill.test.tsx`

The reusable dropdown pill. Editable state shows colored text + dropdown arrow. Read-only shows muted text, no arrow. Click opens a small menu with options.

- [ ] **Step 1: Write failing tests**

```tsx
// ToolbarPill.test.tsx
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ToolbarPill } from "./ToolbarPill.js"

describe("ToolbarPill", () => {
  const options = [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
  ]

  it("renders the current label", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Normal" options={options} value="normal" onChange={() => {}} />,
    )
    expect(html).toContain("Normal")
    expect(html).toContain("input-dock__pill")
  })

  it("renders with icon when provided", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Full access" icon="🛡" options={options} value="normal" onChange={() => {}} />,
    )
    expect(html).toContain("🛡")
  })

  it("renders dropdown arrow when editable", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Normal" options={options} value="normal" onChange={() => {}} />,
    )
    expect(html).toContain("input-dock__pill-arrow")
  })

  it("renders without dropdown arrow when readOnly", () => {
    const html = renderToStaticMarkup(
      <ToolbarPill label="Normal" options={options} value="normal" onChange={() => {}} readOnly />,
    )
    expect(html).toContain("input-dock__pill--readonly")
    expect(html).not.toContain("input-dock__pill-arrow")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chats/input-dock/ToolbarPill.test.tsx`

- [ ] **Step 3: Implement ToolbarPill**

The component:
- Renders a button with optional icon, label, and dropdown arrow
- On click (when not readOnly): toggles a dropdown menu positioned below
- Dropdown shows options with checkmark on current selection
- Click option: calls `onChange(value)`, closes dropdown
- Click outside: closes dropdown
- `readOnly` prop: muted styling, no interactivity

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/input-dock/
git commit -m "feat(ulr-100): add ToolbarPill dropdown component with tests"
```

---

### Task 2: FileAttachmentBar Component

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/input-dock/FileAttachmentBar.tsx`

- [ ] **Step 1: Implement the component**

Renders file preview badges. Each badge: file type icon (🖼 for images, 📄 for others) + truncated filename + ✕ remove button.

```tsx
type Props = {
  files: File[]
  onRemove: (index: number) => void
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/input-dock/FileAttachmentBar.tsx
git commit -m "feat(ulr-100): add FileAttachmentBar component"
```

---

### Task 3: InputDock Component and CSS

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/input-dock/InputDock.tsx`
- Create: `apps/desktop/src/renderer/src/chats/input-dock/input-dock.css`

This is the main component. It replaces the entire input form.

- [ ] **Step 1: Implement InputDock**

Key behaviors:
- **Textarea:** borderless, auto-grows (min 2 lines, max 8), Enter to send, Shift+Enter for newline
- **Toolbar row:** `[+attach] [Model ▾] [Thinking ▾] [🛡 Permissions ▾] ··· [↑ send]`
- **File attachment:** `+` button opens hidden `<input type="file">`, files appear in `FileAttachmentBar`
- **Drag-and-drop:** `onDragOver`/`onDrop` handlers on container, blue dashed border overlay
- **Send:** calls `onSend(prompt, attachments)`, clears textarea and files
- **Disabled state:** textarea read-only, pills inactive, send button disabled
- **First turn vs after:** `isFirstTurn` controls whether pills are editable or read-only

Props match the spec:
```tsx
type InputDockProps = {
  chatId: string
  disabled: boolean
  isFirstTurn: boolean
  provider: string
  model: string
  thinkingLevel: string
  permissionLevel: string
  availableModels: string[]
  onSend: (prompt: string, attachments: File[]) => void
  onRuntimeConfigChange: (config: {
    provider?: string
    model?: string
    thinkingLevel?: string
    permissionLevel?: string
  }) => void
}
```

Model pill options: built from `availableModels` prop.
Thinking level options: `["default", "low", "medium", "high", "max"]`.
Permission options: `[{ value: "full_access", label: "Full access" }, { value: "supervised", label: "Supervised" }]`.

- [ ] **Step 2: Write the CSS**

All styles in `input-dock.css` using design tokens. Key classes:
- `.input-dock` — rounded container (border-radius: 12px)
- `.input-dock__textarea` — borderless, transparent bg, auto-grow
- `.input-dock__toolbar` — flex row
- `.input-dock__pill` / `.input-dock__pill--readonly` — pill styling
- `.input-dock__pill-menu` — absolute dropdown
- `.input-dock__send` — circular button
- `.input-dock__attach` — bordered icon button
- `.input-dock__file-bar` — flex-wrap row
- `.input-dock__file-badge` — file preview badges
- `.input-dock__drop-overlay` — drag-and-drop state

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/input-dock/
git commit -m "feat(ulr-100): add InputDock component and CSS"
```

---

### Task 4: Wire InputDock into ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` (lines 1085-1228)

- [ ] **Step 1: Add InputDock import**

```ts
import { InputDock } from "../chats/input-dock/InputDock.js"
```

- [ ] **Step 2: Build model options from existing state**

Near the existing runtime config state (around line 420), add:

```ts
const availableModels = getModelsForRuntimeProvider(
  (isPreSendRuntimeConfig ? runtimeProviderDraft : activeChat?.provider ?? "claude") as RuntimeProvider,
)
```

- [ ] **Step 3: Create handleSend and handleRuntimeConfigChange**

```ts
const handleSend = (prompt: string, _attachments: File[]) => {
  if (!activeChatId || !activeChat) return
  // Same logic as current handleStartTurn but adapted
  const run = async () => {
    const firstTurnRuntimeConfig =
      isPreSendRuntimeConfig && runtimeDraftDirty
        ? {
            provider: runtimeProviderDraft,
            model: runtimeModelDraft,
            thinkingLevel: activeChat.thinkingLevel,
            permissionLevel: activeChat.permissionLevel,
          }
        : undefined

    await startChatTurn(activeChatId, prompt, actions, undefined, firstTurnRuntimeConfig)
    // ... replay events same as current
  }
  void run().catch(console.error)
}

const handleRuntimeConfigChange = (config: {
  provider?: string; model?: string; thinkingLevel?: string; permissionLevel?: string
}) => {
  if (!activeChatId || !activeChat) return
  void persistRuntimeDraft(
    config.provider ?? activeChat.provider,
    config.model ?? activeChat.model,
    config.thinkingLevel,
    config.permissionLevel,
  )
}
```

- [ ] **Step 4: Replace the form with InputDock**

Replace lines 1085-1228 (the entire `<form>`) with:

```tsx
<InputDock
  chatId={activeChatId!}
  disabled={chatInputDisabled}
  isFirstTurn={isPreSendRuntimeConfig}
  provider={isPreSendRuntimeConfig ? runtimeProviderDraft : activeChat!.provider}
  model={isPreSendRuntimeConfig ? runtimeModelDraft : activeChat!.model}
  thinkingLevel={activeChat!.thinkingLevel}
  permissionLevel={activeChat!.permissionLevel}
  availableModels={availableModels}
  onSend={handleSend}
  onRuntimeConfigChange={handleRuntimeConfigChange}
/>
```

- [ ] **Step 5: Remove the old chatInput state and handleStartTurn** if no longer needed, or keep as fallback.

- [ ] **Step 6: Run frontend tests**

Run: `cd apps/desktop && npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ChatPageShell.tsx
git commit -m "feat(ulr-100): wire InputDock into ChatPageShell"
```

---

### Task 5: Remove Old Input Dock CSS

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css` (lines 747-873)

- [ ] **Step 1: Remove old classes**

Delete these class definitions from app.css (lines 747-873):
- `.active-chat-pane__input-dock`
- `.active-chat-pane__runtime-config`
- `.active-chat-pane__runtime-config-label`
- `.active-chat-pane__runtime-config-row`
- `.active-chat-pane__runtime-config-field`
- `.active-chat-pane__runtime-config-select`
- `.active-chat-pane__input-label`
- `.active-chat-pane__input-row`
- `.active-chat-pane__input`
- `.active-chat-pane__send`
- `.active-chat-pane__button-stack`
- `.active-chat-pane__stop`
- `.active-chat-pane__input-hint`

Also remove responsive overrides (lines 2268-2279).

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "chore(ulr-100): remove old input dock CSS"
```

---

### Task 6: Visual Verification

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

- [ ] **Step 2: Test before first turn**

- Open a new chat
- Verify: rounded input container, model pill (editable dropdown), thinking pill, permissions pill
- Click model pill → dropdown with model options
- Click thinking pill → dropdown with level options
- Click permissions pill → dropdown with Full access / Supervised
- Send button is circular ↑
- `+` button opens file picker

- [ ] **Step 3: Test after first turn**

- Send a message
- Verify: pills become read-only (greyed, no dropdown arrow)
- Textarea still works for follow-up messages
- Send button works

- [ ] **Step 4: Test file attachment**

- Click `+` → select a file → badge appears
- Click ✕ on badge → file removed
- Drag a file over the input → blue dashed border overlay
- Drop file → badge appears

- [ ] **Step 5: Test Enter to send**

- Type a message → press Enter → message sends
- Press Shift+Enter → new line (doesn't send)

- [ ] **Step 6: Final commit if cleanup needed**

```bash
git add -A
git commit -m "chore(ulr-100): input dock visual polish and cleanup"
```
