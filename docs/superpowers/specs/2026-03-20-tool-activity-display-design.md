# ULR-98: Inline Tool Activity Display During Streaming

## Status

Design — approved, pending implementation.

## Objective

Show tool calls (bash commands, file reads, edits, searches) inline in the chat transcript during streaming turns. Users see what the LLM is doing in real-time, with collapsible groups that auto-collapse when text resumes.

## Context

The Claude SDK and Codex app-server adapters emit `tool_activity` events during turns. These are persisted as `chat.turn_progress` turn events and delivered to the frontend via subscription. Currently the frontend only renders `chat.turn_assistant_delta` events (text) — tool activity is invisible except for an event count in the References panel.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Collapsible group panel | Compact by default, expandable for details |
| Grouping | One group per tool burst | Interleaved with text, mirrors the natural "think → act → think" flow |
| Streaming behavior | Expanded while active, auto-collapse when text resumes | User sees activity in real-time; tools get out of the way when text flows |
| Entry detail | Icon + tool name + primary argument + status | Enough to know what happened without overwhelming |
| Unknown tools | Generic fallback | Never breaks on new tools |
| Persisted messages | Text only | Tool activity visible during streaming only; turn events stored for future history view |
| Backend changes | None | Events already flowing correctly |

## Data Model

### StreamingBlock

The streaming message is rendered from an ordered array of blocks:

```ts
type StreamingBlock =
  | { type: "text"; content: string }
  | { type: "tool_group"; id: string; tools: ToolEntry[]; collapsed: boolean }

type ToolEntry = {
  id: string
  toolName: string
  detail: string        // command, file path, search pattern, etc.
  icon: string          // "terminal" | "file" | "pencil" | "search" | "globe" | "tool"
  status: "running" | "done" | "error"
}
```

### Building Blocks from Turn Events

The hook scans `activeTurnEvents` in sequence order:

1. `chat.turn_assistant_delta` → append text to the current text block. If the previous block was a `tool_group`, start a new text block.
2. `chat.turn_progress` with `stage: "tool_activity"` → append a `ToolEntry` to the current tool_group. If the previous block was text, start a new tool_group.

This naturally produces: `[text, tool_group, text, tool_group, text]`.

### Tool Status Heuristic

**Deduplication:** Both Claude and Codex emit multiple events per tool invocation (Claude: `content_block_start` then `assistant` message; Codex: `item/started` then `item/completed`). Use `metadata.id` (Claude) or `metadata.item?.id` (Codex) to deduplicate — update an existing `ToolEntry` rather than creating a new one.

**Status tracking:**
- First `tool_activity` event for a given tool ID → mark as `"running"`, add to current tool_group
- Second event for the same tool ID → update to `"done"` (Codex `item/completed` implies done)
- When the next text block starts after a tool_group → mark any remaining `"running"` tools as `"done"` and set `collapsed: true`
- On turn error → mark the last running tool as `"error"`

**Filtering `command_output` / `file_change` deltas:** Codex emits `tool_activity` events with `label: "command_output"` or `label: "file_change"` for incremental output deltas. These arrive frequently (potentially hundreds per command) and should NOT create new ToolEntry rows. Instead, filter them out of block building entirely — they carry no useful display info beyond "command is still running," which the pulsing status already conveys.

### Actual Event Payload Shape

The turn event payload is `{ stage: "tool_activity", label: string, metadata: Record<string, unknown> | null }`.

**Claude adapter payloads:**
- From `content_block_start`: `{ label: "bash", metadata: { id: "toolu_123" } }` — no input yet
- From complete `assistant` message: `{ label: "bash", metadata: { id: "toolu_123", input: { command: "ls -la" } } }` — has input

**Codex adapter payloads:**
- From `item/started`: `{ label: "bash", metadata: { item: { id: "item_1", type: "command_execution" }, ... } }`
- From `item/completed`: `{ label: "bash", metadata: { item: { id: "item_1", type: "command_execution", command: "ls -la" }, ... } }`

### Tool Type Map

The `extractDetail` functions navigate `metadata` (not `input` directly) and handle both providers:

```ts
const TOOL_MAP: Record<string, { icon: string; extractDetail: (metadata: any) => string }> = {
  bash:      { icon: "terminal", extractDetail: (m) => m?.input?.command ?? m?.item?.command ?? "" },
  Read:      { icon: "file",     extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Edit:      { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Write:     { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Grep:      { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  Glob:      { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  WebSearch: { icon: "globe",    extractDetail: (m) => m?.input?.query ?? "" },
  WebFetch:  { icon: "globe",    extractDetail: (m) => m?.input?.url ?? "" },
}

// Fallback for unknown tools:
// icon: "tool", detail: first string value from metadata or tool name
```

**ID extraction for deduplication:**
- Claude: `metadata?.id` (tool use block ID)
- Codex: `metadata?.item?.id` (item ID)
- Fallback: generate synthetic ID from event sequence number

## Components

### useStreamingBlocks Hook

**File:** `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts`

Replaces `useStreamingText`. Returns `StreamingBlock[] | null` and `isStreaming: boolean`.

```ts
function useStreamingBlocks(
  activeTurnEvents: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,
): { blocks: StreamingBlock[] | null; isStreaming: boolean }
```

The hook:
- Scans events to build the ordered block array
- Deduplicates tool entries by ID (update existing rather than append)
- Filters out `command_output` / `file_change` delta labels
- Tracks tool status via the text-resumption heuristic
- Auto-collapses tool_groups when text follows them
- Returns `null` when not streaming (same pattern as `useStreamingText`)
- **Must replicate the race-condition guard from `useStreamingText`:** keep showing blocks until the final persisted message arrives (track `messageCountAtTurnStart` via ref, same pattern)

**Block IDs:** Use `eventId` from the turn event for `ToolEntry.id`. Use a stable synthetic key for `tool_group.id` (e.g., `"tg-{firstEventSequence}"`).

### StreamingMessage Component

**File:** `apps/desktop/src/renderer/src/chats/streaming/StreamingMessage.tsx`

Renders `StreamingBlock[]`:
- `text` blocks → `MarkdownRenderer` (same as current streaming)
- `tool_group` blocks → `ToolActivityGroup`
- When blocks is empty and isStreaming → typing indicator (pulsing dots)

### ToolActivityGroup Component

**File:** `apps/desktop/src/renderer/src/chats/streaming/ToolActivityGroup.tsx`

The collapsible panel:
- **Header:** chevron (▶/▼) + "Tool calls" + count badge + summary badges showing tool names
- **Body:** list of `ToolActivityEntry` rows
- Click header to toggle expanded/collapsed
- Accepts `collapsed` prop from the hook, but user can override via local state

### ToolActivityEntry Component

**File:** `apps/desktop/src/renderer/src/chats/streaming/ToolActivityEntry.tsx`

Single row:
- Icon (unicode or CSS, based on `icon` field)
- Tool name label
- Detail text (monospace, truncated)
- Status: pulsing dot (running), checkmark (done), X (error)

### CSS

**File:** `apps/desktop/src/renderer/src/chats/streaming/streaming.css`

Styles for all streaming components. Uses existing design tokens (`--surface-2`, `--surface-border`, `--text-muted`, `--success`, `--warning`, `--danger`).

## Integration in ChatPageShell

Replace:
```tsx
const { streamingText, isStreaming } = useStreamingText(activeTurnEvents, inFlightTurn, activeChatMessages.length)

{streamingText !== null && (
  <ChatMessage role="assistant" content={streamingText} isStreaming={isStreaming} />
)}
```

With:
```tsx
const { blocks, isStreaming } = useStreamingBlocks(activeTurnEvents, inFlightTurn, activeChatMessages.length)

{blocks !== null && (
  <StreamingMessage blocks={blocks} isStreaming={isStreaming} />
)}
```

Also update `useAutoScroll` dependency from `streamingText` to `blocks`:
```tsx
useAutoScroll(transcriptScrollRef, [activeChatMessages, blocks])
```

## File Summary

**Create:**

| File | Purpose |
|------|---------|
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts` | Hook: build StreamingBlock[] from turn events |
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.test.ts` | Unit tests |
| `apps/desktop/src/renderer/src/chats/streaming/StreamingMessage.tsx` | Renders block array |
| `apps/desktop/src/renderer/src/chats/streaming/ToolActivityGroup.tsx` | Collapsible tool group panel |
| `apps/desktop/src/renderer/src/chats/streaming/ToolActivityEntry.tsx` | Single tool call row |
| `apps/desktop/src/renderer/src/chats/streaming/streaming.css` | Styles |
| `apps/desktop/src/renderer/src/chats/streaming/tool-map.ts` | Tool type → icon + detail extractor registry |

**Modify:**

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx` | Replace `useStreamingText` with `useStreamingBlocks`, replace `ChatMessage` streaming with `StreamingMessage` |

**Keep (no changes):**

| File | Reason |
|------|--------|
| `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.ts` | Keep for now (can remove later if unused) |
| `apps/desktop/src/renderer/src/chat-message/ChatMessage.tsx` | `isStreaming` prop still used by `StreamingMessage` for the typing indicator |
| Backend adapters / turn service | Events already flowing correctly |

## Testing

- **useStreamingBlocks:** Unit tests for block building — text-only, tools-only, interleaved, status transitions, collapse behavior, empty events, unknown tools
- **ToolActivityGroup:** Render tests for expanded/collapsed states, click toggle
- **ToolActivityEntry:** Render tests for each status, known tools, unknown tools
- **StreamingMessage:** Render test for block array rendering
- **Integration:** Verify in ChatPageShell that tool groups appear during streaming and auto-collapse

## Out of Scope

- Streaming command output within tool entries (future: ULR-98 v2)
- File diffs within tool entries
- Tool activity in persisted messages (future: turn history view)
- Codex-specific tool types (ULR-99 — uses same components, different event mapping)
- Approval request UI (ULR-34)

## References

- `vendor/t3code/apps/web/src/components/chat/MessagesTimeline.tsx` — t3code work log pattern
- `apps/backend/src/chats/chat-turn-service.ts:1276-1310` — event mapping
- `apps/desktop/src/renderer/src/chats/hooks/useStreamingText.ts` — current streaming hook
