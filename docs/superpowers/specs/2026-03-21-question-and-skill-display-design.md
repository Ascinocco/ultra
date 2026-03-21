# AskUserQuestion and Skill Usage Display — Design Spec

**Ticket:** ULR-108
**Date:** 2026-03-21
**Status:** Approved

## Goal

Make LLM questions (`AskUserQuestion`) visible as text in the chat with a response indicator, and show skill activations (`Skill`) as amber-colored tool lines. Both streaming and persisted views.

## Detection

Three special tool names detected in both streaming and persistence layers:

| Tool Name | Extract From | Render As |
|-----------|-------------|-----------|
| `AskUserQuestion` | `metadata.input.question` | Visible text block + "Waiting for your response" indicator |
| `Skill` | `metadata.input.skill` | Muted amber line: "Using {skill} skill" |
| Everything else | Existing behavior | Muted tool activity line (unchanged) |

**Fallbacks:**
- If `metadata.input.question` is empty/undefined: fall back to generic tool line ("Called AskUserQuestion")
- If `metadata.input.skill` is empty/undefined: render as "Using skill" (no name)
- Multiple `AskUserQuestion` calls in one turn: each renders as a separate text block

## Streaming Behavior

### AskUserQuestion

In `useStreamingBlocks` / `deriveStreamingBlocks`, detect `AskUserQuestion` **before** the normal tool_group logic:
- Check `event.label === "AskUserQuestion"` at the top of the tool_activity handler
- Extract question text from `event.metadata?.input?.question`
- If question text exists: emit as a `text` block (skip tool_group entirely). This causes preceding tool groups to auto-collapse, which is intentional — the question should be prominent.
- If no question text: fall through to normal tool_group handling

**"Waiting for your response" indicator:**
- Shown when the turn is complete and no new turn is running (i.e., streaming has ended and `isStreaming === false`)
- Appended after the last text block in the `StreamingMessage` component
- Not a new turn status — derived from existing state: `!isStreaming && blocks.length > 0`

### Skill

In `useStreamingBlocks`, Skill events go through the normal tool_group path:
- Add to current `tool_group` block like any other tool
- `ToolActivityInline` detects `toolName === "Skill"` and renders in amber color
- Display format: "Using {skillName} skill"

### Response Flow

No changes needed. The turn ends naturally after `AskUserQuestion`. The input dock is already enabled. User types their answer as a normal message, which becomes the next turn's prompt.

## Persistence

### `buildStructuredBlocks` (backend)

**Type changes required:**

In `chat-turn-service.ts`, update `StructuredBlock` type:
```typescript
// Current: { name: string; detail: string; id?: string | null }
// New:     { name: string; detail: string; id?: string | null; subtype?: string }
```

**AskUserQuestion handling:**
- When building structured blocks, detect `AskUserQuestion` tool calls
- Instead of adding to a `tools` block, emit as a `text` block with the question content
- This mirrors the streaming approach — questions are text, not tools

**Skill handling:**
- Add to `tools` block as normal, with `subtype: "skill"` and `detail` set to the skill name

Extraction logic in `buildStructuredBlocks`:
- `AskUserQuestion`: emit `{ type: "text", content: questionText }` — a text block, not a tool entry
- `Skill`: emit tool entry `{ name: "Skill", detail: input.skill, subtype: "skill" }`
- Everything else: unchanged

### Historical Rendering

**`PersistedAssistantMessage`:**
- Questions are already `text` blocks (from `buildStructuredBlocks`), so they render as normal assistant text via `MarkdownRenderer` — no special handling needed
- "Waiting for your response" indicator: not shown for historical messages (the question was already answered)

**`ToolActivityInline`:**
- Only needs amber Skill rendering — questions never reach this component (they're text blocks)
- Detect `toolName === "Skill"` or `subtype === "skill"` → render in amber
- Add `Skill` to `VERB_MAP`: `Skill: "Using"` and append "skill" suffix in rendering

**`PersistedBlock` type in `PersistedAssistantMessage.tsx`:**
- Add `subtype?: string` to the tool entry type: `Array<{ name: string; detail: string; subtype?: string }>`

### tool-map.ts

Add entries for both tool names:

```typescript
// In TOOL_MAP
AskUserQuestion: {
  icon: "?",
  extractDetail: (meta) => meta?.input?.question ?? "Question",
},
Skill: {
  icon: "⚡",
  extractDetail: (meta) => meta?.input?.skill ?? "skill",
},
```

## Visual Treatment

### Question
- Renders as normal assistant text (same font, size, color as other assistant content)
- Below the last text block when streaming ends: blue dot (6px) + "Waiting for your response" in blue (#7aa2f7), font-size 10px
- Indicator only shown when actively waiting (streaming ended, no new turn running)

### Skill
- Same muted size as other tool activity lines (12px)
- Amber/warm color (#e0af68) instead of the default muted gray
- Format: "Using {skillName} skill"
- Opacity 0.6, same as other tool lines

## Files Changed

### Backend (1 file)
- `apps/backend/src/chats/chat-turn-service.ts` — `buildStructuredBlocks()`: emit AskUserQuestion as text block, add subtype for Skill; update `StructuredBlock` type to include optional `subtype`

### Frontend (5 files)
- `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts` — detect AskUserQuestion before tool_group logic → emit as text block; Skill passes through normally
- `apps/desktop/src/renderer/src/chats/streaming/ToolActivityInline.tsx` — amber rendering for Skill (add to VERB_MAP), no question handling needed
- `apps/desktop/src/renderer/src/chats/streaming/PersistedAssistantMessage.tsx` — update `PersistedBlock` tool type to include `subtype?`; pass through to `ToolActivityInline`
- `apps/desktop/src/renderer/src/chats/streaming/StreamingMessage.tsx` — add "Waiting for your response" indicator after last block when not streaming
- `apps/desktop/src/renderer/src/chats/streaming/streaming.css` — amber color class for skill lines, waiting indicator styles
- `apps/desktop/src/renderer/src/chats/streaming/tool-map.ts` — add AskUserQuestion and Skill entries

## Out of Scope

- Inline response input field (user responds via normal input dock)
- Question-specific threading (questions are not tracked as a separate entity)
- Skill progress/completion tracking
- New turn status types (we derive waiting state from existing streaming state)
