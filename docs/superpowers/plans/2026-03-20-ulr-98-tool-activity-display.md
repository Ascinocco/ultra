# ULR-98: Inline Tool Activity Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show tool calls inline in the streaming chat message as collapsible work log groups, interleaved with streaming text.

**Architecture:** A `useStreamingBlocks` hook replaces `useStreamingText`, building an ordered array of text and tool_group blocks from turn events. A `StreamingMessage` component renders blocks using `MarkdownRenderer` for text and a new `ToolActivityGroup` collapsible panel for tools. Tool entries show icon, name, detail, and status.

**Tech Stack:** React, TypeScript, Vitest, CSS with design tokens

**Spec:** `docs/superpowers/specs/2026-03-20-tool-activity-display-design.md`

---

## File Structure

**Create:**

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/renderer/src/chats/streaming/tool-map.ts` | Tool type → icon + detail extractor registry |
| `apps/desktop/src/renderer/src/chats/streaming/streaming-types.ts` | StreamingBlock, ToolEntry type definitions |
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts` | Hook: build StreamingBlock[] from turn events |
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.test.ts` | Unit tests |
| `apps/desktop/src/renderer/src/chats/streaming/StreamingMessage.tsx` | Renders StreamingBlock array |
| `apps/desktop/src/renderer/src/chats/streaming/ToolActivityGroup.tsx` | Collapsible tool group panel |
| `apps/desktop/src/renderer/src/chats/streaming/ToolActivityEntry.tsx` | Single tool call row |
| `apps/desktop/src/renderer/src/chats/streaming/streaming.css` | Styles for all streaming components |

**Modify:**

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Replace `useStreamingText` with `useStreamingBlocks`, replace streaming `ChatMessage` with `StreamingMessage`, update `useAutoScroll` deps |

---

### Task 1: Types and Tool Map

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/streaming/streaming-types.ts`
- Create: `apps/desktop/src/renderer/src/chats/streaming/tool-map.ts`

- [ ] **Step 1: Create the type definitions**

```ts
// streaming-types.ts
export type ToolEntryStatus = "running" | "done" | "error"

export type ToolEntry = {
  id: string
  toolName: string
  detail: string
  icon: string
  status: ToolEntryStatus
}

export type StreamingBlock =
  | { type: "text"; content: string }
  | { type: "tool_group"; id: string; tools: ToolEntry[]; collapsed: boolean }
```

- [ ] **Step 2: Create the tool map**

```ts
// tool-map.ts
type ToolConfig = {
  icon: string
  extractDetail: (metadata: any) => string
}

const TOOL_MAP: Record<string, ToolConfig> = {
  bash:      { icon: "terminal", extractDetail: (m) => m?.input?.command ?? m?.item?.command ?? "" },
  Read:      { icon: "file",     extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Edit:      { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Write:     { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Grep:      { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  Glob:      { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  WebSearch: { icon: "globe",    extractDetail: (m) => m?.input?.query ?? "" },
  WebFetch:  { icon: "globe",    extractDetail: (m) => m?.input?.url ?? "" },
}

const FILTERED_LABELS = new Set(["command_output", "file_change"])

export function getToolConfig(label: string): ToolConfig {
  return TOOL_MAP[label] ?? {
    icon: "tool",
    extractDetail: (m) => {
      if (!m) return label
      const firstVal = Object.values(m).find((v) => typeof v === "string")
      return (firstVal as string) ?? label
    },
  }
}

export function shouldFilterToolEvent(label: string): boolean {
  return FILTERED_LABELS.has(label)
}

export function extractToolId(metadata: any): string | null {
  return metadata?.id ?? metadata?.item?.id ?? null
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/
git commit -m "feat(ulr-98): add streaming types and tool map registry"
```

---

### Task 2: useStreamingBlocks Hook

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts`
- Create: `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// useStreamingBlocks.test.ts
import { describe, expect, it } from "vitest"
import { deriveStreamingBlocks } from "./useStreamingBlocks.js"
import type { ChatTurnEventSnapshot } from "@ultra/shared"

function makeDeltaEvent(seq: number, text: string): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${seq}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber: seq,
    eventType: "chat.turn_assistant_delta",
    source: "runtime",
    actorType: "assistant",
    actorId: null,
    payload: { text },
    occurredAt: "2026-03-20T00:00:00Z",
    recordedAt: "2026-03-20T00:00:00Z",
  }
}

function makeToolEvent(seq: number, label: string, metadata: any = {}): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${seq}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber: seq,
    eventType: "chat.turn_progress",
    source: "runtime",
    actorType: "assistant",
    actorId: null,
    payload: { stage: "tool_activity", label, metadata },
    occurredAt: "2026-03-20T00:00:00Z",
    recordedAt: "2026-03-20T00:00:00Z",
  }
}

function makeNonRelevantEvent(seq: number): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${seq}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber: seq,
    eventType: "chat.turn_started",
    source: "system",
    actorType: "system",
    actorId: null,
    payload: {},
    occurredAt: "2026-03-20T00:00:00Z",
    recordedAt: "2026-03-20T00:00:00Z",
  }
}

describe("deriveStreamingBlocks", () => {
  it("returns null when turn is not in flight and no deltas", () => {
    const result = deriveStreamingBlocks([], false, 0, 0)
    expect(result.blocks).toBeNull()
  })

  it("returns text block from assistant deltas", () => {
    const events = [makeDeltaEvent(1, "Hello"), makeDeltaEvent(2, " world")]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks![0]).toEqual({ type: "text", content: "Hello world" })
  })

  it("returns tool_group block from tool events", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1", input: { command: "ls" } }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks![0].type).toBe("tool_group")
    const group = result.blocks![0] as any
    expect(group.tools).toHaveLength(1)
    expect(group.tools[0].toolName).toBe("bash")
    expect(group.tools[0].detail).toBe("ls")
    expect(group.tools[0].status).toBe("running")
  })

  it("interleaves text and tool groups", () => {
    const events = [
      makeDeltaEvent(1, "Looking at files..."),
      makeToolEvent(2, "Read", { id: "t1", input: { file_path: "/app/index.ts" } }),
      makeToolEvent(3, "Read", { id: "t2", input: { file_path: "/app/main.ts" } }),
      makeDeltaEvent(4, "Here is what I found."),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(3)
    expect(result.blocks![0].type).toBe("text")
    expect(result.blocks![1].type).toBe("tool_group")
    expect(result.blocks![2].type).toBe("text")
  })

  it("auto-collapses tool group when text follows", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1" }),
      makeDeltaEvent(2, "Done."),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.collapsed).toBe(true)
    expect(group.tools[0].status).toBe("done")
  })

  it("keeps tool group expanded when no text follows (still running)", () => {
    const events = [
      makeDeltaEvent(1, "Let me check..."),
      makeToolEvent(2, "bash", { id: "t1" }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![1] as any
    expect(group.collapsed).toBe(false)
    expect(group.tools[0].status).toBe("running")
  })

  it("deduplicates tool entries by id", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1" }),
      makeToolEvent(2, "bash", { id: "t1", input: { command: "ls" } }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.tools).toHaveLength(1)
    expect(group.tools[0].detail).toBe("ls")
    expect(group.tools[0].status).toBe("done")
  })

  it("filters out command_output events", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1" }),
      makeToolEvent(2, "command_output", {}),
      makeToolEvent(3, "command_output", {}),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.tools).toHaveLength(1)
  })

  it("handles unknown tools with generic fallback", () => {
    const events = [
      makeToolEvent(1, "SomeNewTool", { id: "t1", foo: "bar" }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.tools[0].icon).toBe("tool")
    expect(group.tools[0].toolName).toBe("SomeNewTool")
  })

  it("keeps blocks visible during race condition (turn ended but message not arrived)", () => {
    const events = [makeDeltaEvent(1, "Hello")]
    const result = deriveStreamingBlocks(events, false, 5, 5)
    expect(result.blocks).not.toBeNull()
  })

  it("returns null when turn ended and message arrived", () => {
    const events = [makeDeltaEvent(1, "Hello")]
    const result = deriveStreamingBlocks(events, false, 6, 5)
    expect(result.blocks).toBeNull()
  })

  it("ignores non-relevant events", () => {
    const events = [makeNonRelevantEvent(1), makeDeltaEvent(2, "Hi")]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks![0].type).toBe("text")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chats/hooks/useStreamingBlocks.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

The `deriveStreamingBlocks` pure function scans events in sequence order:
- For each `chat.turn_assistant_delta`: append text to current text block (or start new text block if previous was tool_group)
- For each `chat.turn_progress` with `stage: "tool_activity"`: skip if `shouldFilterToolEvent(label)`, otherwise add/update tool in current tool_group (or start new tool_group if previous was text)
- Deduplicate tools by extracted ID — update existing entry with new detail/status
- When text follows a tool_group: mark group as collapsed, mark all running tools as done

The `useStreamingBlocks` React hook wraps this with `useMemo` and the `messageCountAtTurnStart` ref pattern from `useStreamingText`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/renderer/src/chats/hooks/useStreamingBlocks.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.test.ts
git commit -m "feat(ulr-98): add useStreamingBlocks hook with tests"
```

---

### Task 3: ToolActivityEntry Component

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/streaming/ToolActivityEntry.tsx`

- [ ] **Step 1: Implement the component**

A single row showing: icon + tool name + detail (monospace, truncated) + status indicator.

Icons are unicode: terminal→⚡, file→📄, pencil→✏️, search→🔍, globe→🌐, tool→🔧

Status: running → pulsing yellow dot, done → green ✓, error → red ✗

```tsx
import type { ReactElement } from "react"
import type { ToolEntry } from "./streaming-types.js"

const ICON_MAP: Record<string, string> = {
  terminal: "⚡",
  file: "📄",
  pencil: "✏️",
  search: "🔍",
  globe: "🌐",
  tool: "🔧",
}

export function ToolActivityEntry({ tool }: { tool: ToolEntry }): ReactElement {
  const icon = ICON_MAP[tool.icon] ?? "🔧"
  return (
    <div className="tool-entry">
      <span className="tool-entry__icon">{icon}</span>
      <span className="tool-entry__name">{tool.toolName}</span>
      {tool.detail && (
        <span className="tool-entry__detail">{tool.detail}</span>
      )}
      <span className={`tool-entry__status tool-entry__status--${tool.status}`}>
        {tool.status === "running" && "●"}
        {tool.status === "done" && "✓"}
        {tool.status === "error" && "✗"}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/ToolActivityEntry.tsx
git commit -m "feat(ulr-98): add ToolActivityEntry component"
```

---

### Task 4: ToolActivityGroup Component

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/streaming/ToolActivityGroup.tsx`

- [ ] **Step 1: Implement the component**

Collapsible panel with header (chevron + "Tool calls" + count + summary badges) and expandable body (list of ToolActivityEntry).

```tsx
import { type ReactElement, useState } from "react"
import type { ToolEntry } from "./streaming-types.js"
import { ToolActivityEntry } from "./ToolActivityEntry.js"

type Props = {
  tools: ToolEntry[]
  collapsed: boolean
}

export function ToolActivityGroup({ tools, collapsed: initialCollapsed }: Props): ReactElement {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  // Sync with prop when it changes (auto-collapse from hook)
  // useEffect would work but for simplicity, derive:
  // The prop controls the initial state; user can override via click

  const uniqueNames = [...new Set(tools.map((t) => t.toolName))]
  const summaryBadges = uniqueNames.slice(0, 3)
  const moreCount = uniqueNames.length - summaryBadges.length

  return (
    <div className="tool-group">
      <button
        className="tool-group__header"
        type="button"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="tool-group__chevron">{collapsed ? "▶" : "▼"}</span>
        <span className="tool-group__title">Tool calls</span>
        <span className="tool-group__count">{tools.length}</span>
        <div className="tool-group__badges">
          {summaryBadges.map((name) => (
            <span key={name} className="tool-group__badge">{name}</span>
          ))}
          {moreCount > 0 && (
            <span className="tool-group__badge tool-group__badge--more">+{moreCount}</span>
          )}
        </div>
      </button>
      {!collapsed && (
        <div className="tool-group__body">
          {tools.map((tool) => (
            <ToolActivityEntry key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/ToolActivityGroup.tsx
git commit -m "feat(ulr-98): add ToolActivityGroup collapsible component"
```

---

### Task 5: StreamingMessage Component and CSS

**Files:**
- Create: `apps/desktop/src/renderer/src/chats/streaming/StreamingMessage.tsx`
- Create: `apps/desktop/src/renderer/src/chats/streaming/streaming.css`

- [ ] **Step 1: Implement StreamingMessage**

Renders `StreamingBlock[]`. Text blocks go through `MarkdownRenderer`. Tool groups go through `ToolActivityGroup`. Empty blocks with `isStreaming` show typing indicator.

```tsx
import type { ReactElement } from "react"
import type { StreamingBlock } from "./streaming-types.js"
import { ToolActivityGroup } from "./ToolActivityGroup.js"
import { MarkdownRenderer } from "../../chat-message/markdown-renderer/MarkdownRenderer.js"
import "./streaming.css"

type Props = {
  blocks: StreamingBlock[]
  isStreaming: boolean
}

export function StreamingMessage({ blocks, isStreaming }: Props): ReactElement {
  const hasContent = blocks.some(
    (b) => (b.type === "text" && b.content.length > 0) || b.type === "tool_group",
  )

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
              <ToolActivityGroup
                key={block.id}
                tools={block.tools}
                collapsed={block.collapsed}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the CSS**

```css
/* streaming.css */

/* Tool Group */
.tool-group {
  background: var(--surface-2);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  margin: 8px 0;
  overflow: hidden;
}

.tool-group__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-align: left;
}

.tool-group__header:hover {
  background: var(--surface-border);
}

.tool-group__chevron {
  color: var(--text-muted);
  font-size: 0.625rem;
  width: 12px;
}

.tool-group__title {
  font-weight: 600;
}

.tool-group__count {
  background: var(--surface-border);
  color: var(--text-muted);
  font-size: 0.625rem;
  padding: 1px 6px;
  border-radius: 10px;
}

.tool-group__badges {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.tool-group__badge {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
  font-size: 0.5625rem;
  padding: 2px 6px;
  border-radius: 3px;
}

.tool-group__badge--more {
  background: var(--surface-border);
  color: var(--text-muted);
}

.tool-group__body {
  border-top: 1px solid var(--surface-border);
  padding: 4px 0;
}

/* Tool Entry */
.tool-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 0.6875rem;
}

.tool-entry__icon {
  font-size: 0.8125rem;
  width: 18px;
  text-align: center;
}

.tool-entry__name {
  color: var(--text-secondary);
  font-weight: 500;
}

.tool-entry__detail {
  color: var(--text-muted);
  font-family: monospace;
  font-size: 0.625rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.tool-entry__status {
  margin-left: auto;
  font-size: 0.625rem;
}

.tool-entry__status--running {
  color: var(--warning);
  animation: tool-pulse 1.4s ease-in-out infinite;
}

.tool-entry__status--done {
  color: var(--success);
}

.tool-entry__status--error {
  color: var(--danger);
}

@keyframes tool-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

- [ ] **Step 3: Run all frontend tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/chats/streaming/
git commit -m "feat(ulr-98): add StreamingMessage component and streaming CSS"
```

---

### Task 6: Wire into ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

- [ ] **Step 1: Update imports**

Replace:
```ts
import { useStreamingText } from "../chats/hooks/useStreamingText.js"
```
With:
```ts
import { useStreamingBlocks } from "../chats/hooks/useStreamingBlocks.js"
import { StreamingMessage } from "../chats/streaming/StreamingMessage.js"
```

- [ ] **Step 2: Update hook call (line 434-438)**

Replace:
```ts
const { streamingText, isStreaming } = useStreamingText(
  activeTurnEvents,
  inFlightTurn,
  activeChatMessages.length,
)
```
With:
```ts
const { blocks: streamingBlocks, isStreaming } = useStreamingBlocks(
  activeTurnEvents,
  inFlightTurn,
  activeChatMessages.length,
)
```

- [ ] **Step 3: Update useAutoScroll deps (line 440)**

Replace:
```ts
useAutoScroll(transcriptScrollRef, [activeChatMessages, streamingText])
```
With:
```ts
useAutoScroll(transcriptScrollRef, [activeChatMessages, streamingBlocks])
```

- [ ] **Step 4: Update streaming message render (lines 1004-1010)**

Replace:
```tsx
{streamingText !== null && (
  <ChatMessage
    role="assistant"
    content={streamingText}
    isStreaming={isStreaming}
  />
)}
```
With:
```tsx
{streamingBlocks !== null && (
  <StreamingMessage
    blocks={streamingBlocks}
    isStreaming={isStreaming}
  />
)}
```

- [ ] **Step 5: Run all frontend tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ChatPageShell.tsx
git commit -m "feat(ulr-98): wire streaming blocks and tool activity into ChatPageShell"
```

---

### Task 7: Visual Verification

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

- [ ] **Step 2: Test with Claude chat**

Send a message that triggers tool use (e.g., "Tell me about this project's package.json").

Verify:
- Typing indicator shows initially
- Tool group appears when tools start (expanded, showing tool entries)
- Tool entries show correct icon, name, detail, pulsing status
- When text resumes, tool group auto-collapses
- Text streams after the collapsed group
- Multiple tool bursts create multiple groups
- Clicking collapsed group header expands it
- Final persisted message shows text only (no tool groups)

- [ ] **Step 3: Test with Codex chat**

Same verification with Codex provider.

- [ ] **Step 4: Final commit if cleanup needed**

```bash
git add -A
git commit -m "chore(ulr-98): tool activity display cleanup and polish"
```
