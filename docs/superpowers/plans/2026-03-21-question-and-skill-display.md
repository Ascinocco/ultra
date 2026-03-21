# AskUserQuestion and Skill Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LLM questions visible as text with a response indicator, and show skill activations as amber tool lines — both streaming and persisted.

**Architecture:** Detect `AskUserQuestion` and `Skill` tool names in both the streaming pipeline (`useStreamingBlocks`) and persistence pipeline (`buildStructuredBlocks`). Questions emit as text blocks; skills render as amber-colored tool lines. No new IPC commands or schemas needed.

**Tech Stack:** TypeScript, React, Vitest

**Spec:** `docs/superpowers/specs/2026-03-21-question-and-skill-display-design.md`

---

### Task 1: Add AskUserQuestion and Skill to tool-map.ts

**Files:**
- Modify: `apps/desktop/src/renderer/src/chats/streaming/tool-map.ts`

- [ ] **Step 1: Add entries to TOOL_MAP**

Add after the existing Codex entries (after line 33 in `tool-map.ts`):

```typescript
  // Special tool types
  AskUserQuestion:    { icon: "question", extractDetail: (m) => m?.input?.question ?? m?.input?.text ?? "" },
  Skill:              { icon: "skill",    extractDetail: (m) => m?.input?.skill ?? "" },
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/tool-map.ts
git commit -m "feat: add AskUserQuestion and Skill to tool-map"
```

---

### Task 2: Handle AskUserQuestion as text block in useStreamingBlocks

**Files:**
- Modify: `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts`

- [ ] **Step 1: Add AskUserQuestion interception before tool_group logic**

In `deriveStreamingBlocks`, find the `tool_activity` handling section (around line 38). After the `shouldFilterToolEvent` check and before the tool_group logic, add:

```typescript
      // After: if (shouldFilterToolEvent(label)) continue
      // Before: const metadata = payload.metadata

      // AskUserQuestion: emit as text block instead of tool_group
      if (label === "AskUserQuestion") {
        const questionText = (payload.metadata as any)?.input?.question
          ?? (payload.metadata as any)?.input?.text
          ?? ""
        if (questionText) {
          hasContent = true
          const last = blocks[blocks.length - 1]
          if (last && last.type === "text") {
            last.content += "\n\n" + questionText
          } else {
            blocks.push({ type: "text", content: questionText })
          }
          continue
        }
        // If no question text, fall through to normal tool handling
      }
```

This intercepts AskUserQuestion before the tool_group logic, so the question renders as visible assistant text. Preceding tool groups auto-collapse (existing behavior for text following tools).

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts
git commit -m "feat: render AskUserQuestion as text block during streaming"
```

---

### Task 3: Add amber Skill rendering to ToolActivityInline

**Files:**
- Modify: `apps/desktop/src/renderer/src/chats/streaming/ToolActivityInline.tsx`
- Modify: `apps/desktop/src/renderer/src/chats/streaming/streaming.css`

- [ ] **Step 1: Add Skill to VERB_MAP**

In `ToolActivityInline.tsx`, add to the `VERB_MAP` object (around line 9):

```typescript
  Skill: "Using",
```

- [ ] **Step 2: Update ToolLine to handle Skill rendering**

Replace the `ToolLine` component (lines 49-62) with:

```tsx
function ToolLine({ tool }: { tool: ToolEntry }): ReactElement {
  const isSkill = tool.toolName === "Skill"
  const verb = getVerb(tool.toolName)
  const detail = formatDetail(tool)
  const isRunning = tool.status === "running"

  return (
    <div className={`tool-inline ${isRunning ? "tool-inline--running" : ""} ${isSkill ? "tool-inline--skill" : ""}`}>
      <span className="tool-inline__verb">{verb}</span>
      {" "}
      <span className="tool-inline__detail">{isSkill ? `${detail} skill` : detail}</span>
      {isRunning && <span className="tool-inline__dot">●</span>}
    </div>
  )
}
```

- [ ] **Step 3: Add amber CSS class**

In `streaming.css`, add after the `.tool-inline--running` rule:

```css
.tool-inline--skill {
  color: #e0af68;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/ToolActivityInline.tsx apps/desktop/src/renderer/src/chats/streaming/streaming.css
git commit -m "feat: render Skill tool activity in amber color"
```

---

### Task 4: Add "Waiting for your response" indicator to StreamingMessage

**Files:**
- Modify: `apps/desktop/src/renderer/src/chats/streaming/StreamingMessage.tsx`
- Modify: `apps/desktop/src/renderer/src/chats/streaming/streaming.css`

- [ ] **Step 1: Add waiting indicator to StreamingMessage**

The indicator should appear after the last block when streaming has ended. Update the component:

```tsx
export function StreamingMessage({ blocks, isStreaming }: Props): ReactElement {
  const hasContent = blocks.some(
    (b) => (b.type === "text" && b.content.length > 0) || b.type === "tool_group",
  )

  // Show waiting indicator when streaming ended and last block is text
  // (which means the LLM asked a question and is waiting for response)
  const lastBlock = blocks[blocks.length - 1]
  const showWaiting = !isStreaming && hasContent && lastBlock?.type === "text"

  return (
    <div className="streaming-message chat-message chat-message--coordinator">
      <div className="chat-message__label">Assistant</div>
      <div className="chat-message__content">
        {!hasContent && isStreaming ? (
          <div className="chat-message__typing">
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
            <span className="chat-message__typing-dot" />
          </div>
        ) : (
          blocks.map((block, i) => {
            if (block.type === "text") {
              return block.content ? (
                <MarkdownRenderer key={`text-${i}`} content={block.content} />
              ) : null
            }
            return (
              <ToolActivityInline
                key={block.id}
                tools={block.tools}
              />
            )
          })
        )}
        {showWaiting && (
          <div className="streaming-message__waiting">
            <span className="streaming-message__waiting-dot" />
            Waiting for your response
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add waiting indicator CSS**

In `streaming.css`, add:

```css
.streaming-message__waiting {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #7aa2f7;
  font-size: 10px;
  padding: 4px 0;
  margin-top: 4px;
}

.streaming-message__waiting-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7aa2f7;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/StreamingMessage.tsx apps/desktop/src/renderer/src/chats/streaming/streaming.css
git commit -m "feat: add 'Waiting for your response' indicator to StreamingMessage"
```

---

### Task 5: Handle AskUserQuestion and Skill in backend buildStructuredBlocks

**Files:**
- Modify: `apps/backend/src/chats/chat-turn-service.ts`

- [ ] **Step 1: Update StructuredBlock type**

Update the type at line 42-44:

```typescript
type StructuredBlock =
  | { type: "text"; content: string }
  | { type: "tools"; tools: Array<{ name: string; detail: string; id?: string | null; subtype?: string }> }
```

- [ ] **Step 2: Add AskUserQuestion and Skill handling to extractToolDetail**

In `extractToolDetail` (line 90), add cases before the `default`:

```typescript
    case "AskUserQuestion":
      return m?.input?.question ?? m?.input?.text ?? ""
    case "Skill":
      return m?.input?.skill ?? ""
```

- [ ] **Step 3: Handle AskUserQuestion as text block in buildStructuredBlocks**

In `buildStructuredBlocks` (line 49), after the `NON_TOOL_LABELS` check (`if (event.type === "tool_activity" && !NON_TOOL_LABELS.has(event.label))`), add AskUserQuestion detection before the normal tool logic:

```typescript
    } else if (event.type === "tool_activity" && event.label === "AskUserQuestion") {
      const questionText = extractToolDetail("AskUserQuestion", event.metadata)
      if (questionText) {
        const last = lastBlock()
        if (last?.type === "text") {
          last.content += "\n\n" + questionText
        } else {
          blocks.push({ type: "text", content: questionText })
        }
      }
    } else if (event.type === "tool_activity" && !NON_TOOL_LABELS.has(event.label)) {
```

Note: the existing `else if` for tool_activity becomes a second `else if` — the AskUserQuestion check goes first.

- [ ] **Step 4: Add subtype for Skill tools**

In the tool_activity handler inside `buildStructuredBlocks`, after the line that pushes a new tool entry (`last.tools.push(...)` or `blocks.push({ type: "tools", tools: [...] })`), add subtype for Skill:

```typescript
const subtype = event.label === "Skill" ? "skill" : undefined
// Then use it in the push:
{ name: event.label, detail, id: toolId, subtype }
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/chats/chat-turn-service.ts
git commit -m "feat: handle AskUserQuestion as text and Skill with subtype in buildStructuredBlocks"
```

---

### Task 6: Update PersistedAssistantMessage for Skill amber rendering

**Files:**
- Modify: `apps/desktop/src/renderer/src/chats/streaming/PersistedAssistantMessage.tsx`
- Modify: `apps/desktop/src/renderer/src/chats/streaming/streaming-types.ts`

- [ ] **Step 1: Add optional subtype to ToolEntry type**

In `streaming-types.ts`, update `ToolEntry`:

```typescript
export type ToolEntry = {
  id: string
  toolName: string
  detail: string
  icon: string
  status: ToolEntryStatus
  subtype?: string
}
```

- [ ] **Step 2: Update PersistedBlock type and toToolEntries**

In `PersistedAssistantMessage.tsx`, update the tool array type in `PersistedBlock`:

```typescript
type PersistedBlock =
  | { type: "text"; content: string }
  | { type: "tools"; tools: Array<{ name: string; detail: string; subtype?: string }> }
```

Update `toToolEntries` to pass through subtype:

```typescript
function toToolEntries(tools: Array<{ name: string; detail: string; subtype?: string }>): ToolEntry[] {
  return tools.map((t, i) => ({
    id: `persisted-${i}`,
    toolName: t.name,
    detail: t.detail,
    icon: getToolConfig(t.name).icon,
    status: "done" as const,
    subtype: t.subtype,
  }))
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/PersistedAssistantMessage.tsx apps/desktop/src/renderer/src/chats/streaming/streaming-types.ts
git commit -m "feat: pass subtype through to ToolEntry for persisted skill rendering"
```

---

### Task 7: Manual integration test

- [ ] **Step 1: Test AskUserQuestion rendering**

Start the app. In a chat, ask the LLM something that triggers `AskUserQuestion` (e.g. ask it to brainstorm — superpowers skill uses AskUserQuestion). Verify:
- Question text appears as visible assistant text (not "Called AskUserQuestion")
- "Waiting for your response" indicator shows after streaming ends
- User can type a response normally
- After responding, the indicator disappears

- [ ] **Step 2: Test Skill rendering**

In a chat, trigger a skill (e.g. ask to brainstorm something). Verify:
- "Using brainstorming skill" appears in amber (#e0af68) among the tool lines
- Both during streaming and in persisted/historical view

- [ ] **Step 3: Test edge cases**

- Verify normal tool calls still render as before (no regression)
- Verify empty AskUserQuestion (if possible) falls through to generic tool line
- Verify historical messages with questions render the text (without waiting indicator)
