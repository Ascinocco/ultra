# Chat Message Rendering — Design Spec

## Problem

The current chat UI renders messages as plain text inside colored bubble wrappers (blue-tinted for assistant, gray for user). There is no markdown rendering, no syntax highlighting, no copy functionality, and no support for diagrams or math. The colored wrappers look dated and disconnected.

## Goals

1. Replace colored message bubbles with a clean, Codex-style flat layout
2. Render assistant messages as full markdown with GFM support
3. Add syntax-highlighted code blocks with per-block copy buttons
4. Add a hover-reveal copy button for entire assistant messages
5. Support mermaid diagrams and LaTeX/math with rendered output + source toggle
6. Maintain the existing dark theme aesthetic (#1a1d27 background, cool blue-gray palette)

## Design Decisions

### Message Layout: Codex-Style Flat

- **No bubbles or colored backgrounds** on messages
- Messages separated by subtle horizontal dividers (`1px solid rgba(255,255,255,0.06)`)
- Role label above each message: small, uppercase, muted (`#8494b0`, 11px, 600 weight, 0.5px letter-spacing)
  - User messages (role: `"user"`): label reads "You", content in primary text color (`#eef1f8`)
  - Coordinator messages (role: `"coordinator"`): label reads "Assistant", content in secondary text color (`#b0bbd0`)
  - System messages (role: `"system"`): label reads "System", content in muted text color (`#8494b0`)
- Note: the data model uses role `"coordinator"` but the display label should read "Assistant" for user-friendliness
- Message text at 14px, line-height 1.7
- **Markdown rendering applies only to coordinator messages.** User messages render as plain text with `white-space: pre-wrap` (avoids accidental formatting of user-typed markdown syntax). System messages also render as plain text.
- Empty or whitespace-only messages are hidden (not rendered)

### Message Types

The `ThreadMessageSnapshot.messageType` field has values: `"text"`, `"status"`, `"blocking_question"`, `"summary"`, `"review_ready"`, `"change_request_followup"`. For this initial implementation, all message types render using the same layout. Specialized visual treatments for `status`, `blocking_question`, etc. are out of scope and can be layered on later.

### Container Layout

The current conversation container has a `max-height: 300px` constraint. This must be removed or significantly increased — rich markdown content (code blocks, diagrams, tables) requires much more vertical space. The conversation container should flex to fill available space within the thread detail pane, with `overflow-y: auto` for scrolling.

### Markdown Rendering Scope

**Supported elements:**

| Category | Elements |
|----------|----------|
| Inline | Bold, italic, strikethrough, inline code, links |
| Block | Paragraphs, headings (h1-h4), ordered/unordered lists, task lists (checkboxes) |
| Rich | Fenced code blocks (with syntax highlighting), tables, blockquotes, horizontal rules, images |
| Special | Mermaid diagrams (rendered), LaTeX/math via KaTeX (rendered) |

**Not supported:** Footnotes, raw HTML passthrough.

### Code Blocks

- Background: `rgba(255,255,255,0.03)`
- Left accent border: 3px solid `#5b8def`
- Border radius: 6px
- Header bar with:
  - Language label (left, 11px, `#8494b0`)
  - **Always-visible** "Copy" button (right, 11px, `rgba(255,255,255,0.05)` background, `#8494b0` text)
- Code font: `'SF Mono', 'Fira Code', monospace` at 13px, line-height 1.6
- Horizontal scroll for long lines (`overflow-x: auto`)
- Syntax highlighting theme: **Material Palenight**
  - Keywords: `#c792ea` (purple)
  - Strings: `#c3e88d` (green)
  - Numbers: `#f78c6c` (orange)
  - Functions: `#82aaff` (blue)
  - Types/classes: `#ffcb6b` (yellow)
  - Comments: `#546e7a` (gray)
  - Operators: `#89ddff` (cyan)
  - Booleans: `#ff5370` (red)

### Copy Behavior

- **Code blocks:** Always-visible "Copy" button in the code block header. Copies the raw code content (no language label).
- **Assistant messages:** Hover-reveal "Copy message" button at bottom-right of the message. Copies the full raw markdown source of the message. Appears on hover with a 150ms opacity transition.
- Both show brief "Copied!" feedback on click.

### Mermaid Diagrams

- Fenced code blocks with language `mermaid` are rendered as SVG diagrams inline
- Header bar shows "mermaid" label (left) and a "View source" toggle (right, `#5b8def` text)
- Clicking "View source" swaps to a standard syntax-highlighted code block showing the mermaid source
- Toggle text changes to "View diagram" when showing source
- Diagram renders with colors that match the Ultra theme (blues, purples, greens from the palette)
- **Error handling:** If mermaid parsing fails, fall back to displaying the raw source as a standard syntax-highlighted code block with a subtle error banner above it (e.g., "Diagram could not be rendered")

### LaTeX / Math

- Inline math: `$...$` rendered inline via KaTeX
- Block math: `$$...$$` rendered as centered block via KaTeX
- Same "View source" toggle pattern as mermaid: rendered by default, toggle to see raw LaTeX
- KaTeX output styled to match text colors (`#eef1f8` for math symbols)
- **Known limitation:** Single-dollar `$...$` delimiters can produce false positives on prose containing dollar amounts (e.g., "$50"). This is a known tradeoff of remark-math. Math rendering only applies to coordinator messages, not user messages, to reduce false positives.

### Inline Code

- Background: `rgba(255,255,255,0.06)`
- Padding: 2px 6px
- Border radius: 3px
- Font: `'SF Mono', monospace` at 13px
- Color: `#c792ea` (purple, matching keyword color from syntax theme)

### Tables

- Full width, collapsed borders
- Header row: bottom border `1px solid rgba(255,255,255,0.1)`, text in `#eef1f8` at 600 weight
- Body rows: bottom border `1px solid rgba(255,255,255,0.04)`, text in `#b0bbd0`
- Cell padding: 6px 10px
- Font size: 13px

### Blockquotes

- Left border: 3px solid `rgba(255,255,255,0.15)`
- Padding: 8px 14px
- Text color: `#8494b0` (muted)
- Font style: italic

### Links

- Color: `#5b8def` (accent blue)
- No text decoration
- Subtle bottom border: `1px solid rgba(91,141,239,0.3)`
- Opens in external browser via custom `<a>` component that calls the Electron IPC bridge to `shell.openExternal`
- Links should not navigate the Electron window itself

### Images

- Rendered inline within the message
- Max width: 100% of message container
- Border radius: 6px
- Optional alt text displayed below as caption in muted text
- **Security:** Only allow images from `data:` URIs and local file paths. Remote URLs should not be loaded directly — if needed in the future, proxy through the backend or require explicit user opt-in.

## Technical Approach

### Libraries

| Library | Purpose |
|---------|---------|
| `react-markdown` | Markdown parsing and React rendering |
| `remark-gfm` | GFM extensions (tables, task lists, strikethrough) |
| `remark-math` | Math syntax parsing (`$`, `$$`) |
| `rehype-katex` | KaTeX rendering for math |
| `shiki` | Syntax highlighting with Material Palenight theme (async/WASM-based, rich grammar support — ideal for Electron where WASM loading is local) |
| `mermaid` | Diagram rendering |
| `katex` | KaTeX CSS stylesheet (~300KB) must be imported for proper math rendering |

### Component Structure

```
ChatMessage                    — outer container, separator line, role label
├── MarkdownRenderer           — react-markdown with all plugins
│   ├── CodeBlock              — fenced code: syntax highlighting + copy
│   │   ├── CodeBlockHeader    — language label + copy button
│   │   └── HighlightedCode   — shiki rendered code
│   ├── MermaidBlock           — rendered diagram + source toggle
│   ├── MathBlock              — KaTeX rendered + source toggle
│   ├── InlineCode             — styled inline code span
│   ├── Table                  — styled table
│   ├── Blockquote             — styled blockquote
│   └── Link                   — external link handler
└── MessageActions             — hover-reveal copy button
```

### Where This Lives

- New component: `ChatMessage.tsx` (replaces current inline `<p>` rendering in `CoordinatorConversation`)
- New component: `MarkdownRenderer.tsx` (reusable — can be used in threads and future surfaces)
- New component: `CodeBlock.tsx` (code block with highlighting and copy)
- New component: `MermaidBlock.tsx` (mermaid rendering with toggle)
- New component: `MathBlock.tsx` (KaTeX rendering with toggle)
- Styles: new CSS file `chat-message.css` (app.css is already 1700+ lines — keep message rendering styles separate)

### What Gets Removed

- The colored message wrapper backgrounds (`rgba(91, 141, 239, 0.06)` for coordinator, `rgba(148, 163, 200, 0.06)` for user, `rgba(250, 204, 21, 0.06)` for system)
- The `coordinator-conversation__message--coordinator`, `--user`, `--system` modifier classes that apply those colors
- The existing `<p className="coordinator-conversation__text">` plain text rendering

## Out of Scope

- Rich text input (user still types plain text)
- Message editing or regeneration
- Streaming/typewriter rendering (can be layered on later)
- Message reactions or feedback buttons
- File/image upload in messages

## Mockups

Visual mockups from the brainstorming session are available at:
`.superpowers/brainstorm/20269-1773954171/full-design.html`
