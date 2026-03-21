# AskUserQuestion and Skill Usage Display — Design Spec

**Ticket:** ULR-108
**Date:** 2026-03-21
**Status:** Approved

## Goal

Make LLM questions (`AskUserQuestion`) visible as text in the chat with a response indicator, and show skill activations (`Skill`) as amber-colored tool lines. Both streaming and persisted views.

## Detection

Three special tool names detected by the frontend rendering layer:

| Tool Name | Extract From | Render As |
|-----------|-------------|-----------|
| `AskUserQuestion` | `metadata.input.question` | Visible text block + "Waiting for your response" indicator |
| `Skill` | `metadata.input.skill` | Muted amber line: "Using {skill} skill" |
| Everything else | Existing behavior | Muted tool activity line (unchanged) |

## Streaming Behavior

### AskUserQuestion

When `useStreamingBlocks` sees a `tool_activity` event with label `AskUserQuestion`:
- Extract question text from `metadata.input.question`
- Emit as a `text` block (not a `tool_group`) so it renders as visible assistant text
- After the turn completes and status is `waiting_for_input`, show a "Waiting for your response" indicator (blue dot + text) below the question

### Skill

When `useStreamingBlocks` sees a `tool_activity` event with label `Skill`:
- Add to the current `tool_group` block like any other tool
- `ToolActivityInline` detects `toolName === "Skill"` and renders in amber color
- Display format: "Using {skillName} skill"

### Response Flow

No changes needed. The turn ends naturally after `AskUserQuestion`. The input dock is already enabled. User types their answer as a normal message, which becomes the next turn's prompt.

## Persistence

### `buildStructuredBlocks` (backend)

Add optional `subtype` field to tool entries in structured blocks:

```typescript
// AskUserQuestion
{ name: "AskUserQuestion", detail: "Should we use session cache?", subtype: "question" }

// Skill
{ name: "Skill", detail: "brainstorming", subtype: "skill" }
```

Extraction logic:
- `AskUserQuestion`: `detail` = `input.question`, `subtype` = `"question"`
- `Skill`: `detail` = `input.skill`, `subtype` = `"skill"`
- Everything else: unchanged

### Historical Rendering

`PersistedAssistantMessage` / `ToolActivityInline` check `subtype`:
- `"question"`: render as visible text paragraph. Show "Waiting for your response" indicator only if this is the last message AND chat status is `waiting_for_input`. Otherwise just show the question text.
- `"skill"`: render in amber color ("Using brainstorming skill")
- No subtype: existing muted tool line

## Visual Treatment

### Question
- Renders as normal assistant text (same font, size, color as other assistant content)
- Below the question: blue dot (6px) + "Waiting for your response" in blue (#7aa2f7), font-size 10px
- Indicator only shown when chat is actively waiting — hidden for historical/answered questions

### Skill
- Same muted size as other tool activity lines (12px)
- Amber/warm color (#e0af68) instead of the default muted gray
- Format: "Using {skillName} skill"
- Opacity 0.6, same as other tool lines

## Files Changed

### Backend (1 file)
- `apps/backend/src/chats/chat-turn-service.ts` — `buildStructuredBlocks()`: add `subtype` and smarter `detail` extraction for `AskUserQuestion` and `Skill`

### Frontend (4 files)
- `apps/desktop/src/renderer/src/chats/hooks/useStreamingBlocks.ts` — detect `AskUserQuestion` → emit as text block; detect `Skill` → pass through with flag
- `apps/desktop/src/renderer/src/chats/streaming/ToolActivityInline.tsx` — amber rendering for skills, question text rendering for AskUserQuestion
- `apps/desktop/src/renderer/src/chats/streaming/PersistedAssistantMessage.tsx` — same detection for historical messages
- `apps/desktop/src/renderer/src/chats/streaming/streaming.css` — amber color class, waiting indicator styles

## Out of Scope

- Inline response input field (user responds via normal input dock)
- Question-specific threading (questions are not tracked as a separate entity)
- Skill progress/completion tracking
