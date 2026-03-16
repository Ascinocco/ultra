# ULR-31: Open Terminal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire "Open Terminal" to the backend's `terminal.open` IPC and replace the `<pre>` output placeholder with a real xterm.js terminal emulator.

**Architecture:** New `terminal/` modules (workflows, output emitter, subscriptions, TerminalPane component) follow the existing `sandbox-workflows.ts` pattern with narrowed action types and injectable IPC client. Terminal output flows through a session-scoped event emitter to avoid React re-renders, and xterm.js renders PTY output directly.

**Tech Stack:** xterm.js, @xterm/addon-fit, Zustand (existing store), IPC subscriptions via `window.ultraShell`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `terminal/terminal-workflows.ts` | Create | openTerminal, closeTerminalSession, writeTerminalInput, resizeTerminalSession |
| `terminal/terminal-workflows.test.ts` | Create | Unit tests for all workflow functions |
| `terminal/terminal-output-emitter.ts` | Create | Session-scoped event emitter for routing output off React cycle |
| `terminal/terminal-output-emitter.test.ts` | Create | Unit tests for emitter subscribe/emit/cleanup |
| `terminal/terminal-subscriptions.ts` | Create | subscribeToTerminalOutput (session-scoped output subscription) |
| `terminal/terminal-subscriptions.test.ts` | Create | Unit tests for output subscription wiring |
| `terminal/TerminalPane.tsx` | Create | xterm.js wrapper component with fit addon, input/resize/output wiring |
| `terminal/terminal-drawer.test.tsx` | Delete | References deleted `TerminalDrawer.tsx` — broken test |
| `pages/ChatPageShell.tsx` | Modify | Replace `<pre>` with TerminalPane, add +/× tab buttons, wire workflows |
| `components/AppShell.tsx` | Modify | Wire TitleBar toggle to `openTerminal` workflow |
| `test-utils/factories.ts` | Modify | Add `makeTerminalSession` factory |
| `styles/app.css` | Modify | Add xterm container styles |
| `package.json` (apps/desktop) | Modify | Add xterm, @xterm/addon-fit dependencies |

All paths relative to `apps/desktop/src/renderer/src/`.

---

## Chunk 1: Foundation (emitter, factories, dependencies)

### Task 1: Install xterm.js dependencies

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install xterm and fit addon**

```bash
cd apps/desktop && npm install xterm @xterm/addon-fit
```

- [ ] **Step 2: Verify installation**

```bash
ls apps/desktop/node_modules/xterm/package.json && echo "ok"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json apps/desktop/package-lock.json
# Also add root lockfile if hoisted
git commit -m "chore: add xterm and @xterm/addon-fit dependencies"
```

---

### Task 2: Add `makeTerminalSession` test factory

**Files:**
- Modify: `apps/desktop/src/renderer/src/test-utils/factories.ts`

- [ ] **Step 1: Write a quick test to validate the factory**

Create `apps/desktop/src/renderer/src/test-utils/factories.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

import { makeTerminalSession } from "./factories.js"

describe("makeTerminalSession", () => {
  it("creates a session with required fields and overrides", () => {
    const session = makeTerminalSession("term-1", "proj-1", "sb-1", {
      title: "Custom Shell",
    })

    expect(session.sessionId).toBe("term-1")
    expect(session.projectId).toBe("proj-1")
    expect(session.sandboxId).toBe("sb-1")
    expect(session.title).toBe("Custom Shell")
    expect(session.status).toBe("running")
    expect(session.recentOutput).toBe("")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && npx vitest run src/renderer/src/test-utils/factories.test.ts
```
Expected: FAIL — `makeTerminalSession` is not exported

- [ ] **Step 3: Implement the factory**

Add to `apps/desktop/src/renderer/src/test-utils/factories.ts`:

```typescript
import type {
  ChatSummary,
  ProjectSnapshot,
  SandboxContextSnapshot,
  TerminalSessionSnapshot,
} from "@ultra/shared"

// ... existing makeProject, makeChat, makeSandbox ...

export function makeTerminalSession(
  sessionId: string,
  projectId: string,
  sandboxId: string,
  opts?: Partial<TerminalSessionSnapshot>,
): TerminalSessionSnapshot {
  return {
    sessionId,
    projectId,
    sandboxId,
    threadId: null,
    cwd: `/projects/${projectId}`,
    title: `Shell · ${sessionId}`,
    sessionKind: "shell",
    status: "running",
    commandId: null,
    commandLabel: null,
    commandLine: "zsh",
    exitCode: null,
    startedAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    lastOutputAt: null,
    lastOutputSequence: 0,
    recentOutput: "",
    ...opts,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/desktop && npx vitest run src/renderer/src/test-utils/factories.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/test-utils/factories.ts src/renderer/src/test-utils/factories.test.ts
git commit -m "test: add makeTerminalSession factory"
```

---

### Task 3: Create terminal output emitter

**Files:**
- Create: `apps/desktop/src/renderer/src/terminal/terminal-output-emitter.ts`
- Create: `apps/desktop/src/renderer/src/terminal/terminal-output-emitter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/desktop/src/renderer/src/terminal/terminal-output-emitter.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"

import { TerminalOutputEmitter } from "./terminal-output-emitter.js"

describe("TerminalOutputEmitter", () => {
  it("delivers chunks to a registered handler", () => {
    const emitter = new TerminalOutputEmitter()
    const handler = vi.fn()

    emitter.on("session-1", handler)
    emitter.emit("session-1", "hello")

    expect(handler).toHaveBeenCalledWith("hello")
  })

  it("does not deliver to handlers for other sessions", () => {
    const emitter = new TerminalOutputEmitter()
    const handler = vi.fn()

    emitter.on("session-1", handler)
    emitter.emit("session-2", "hello")

    expect(handler).not.toHaveBeenCalled()
  })

  it("stops delivering after off()", () => {
    const emitter = new TerminalOutputEmitter()
    const handler = vi.fn()

    emitter.on("session-1", handler)
    emitter.off("session-1", handler)
    emitter.emit("session-1", "hello")

    expect(handler).not.toHaveBeenCalled()
  })

  it("supports multiple handlers per session", () => {
    const emitter = new TerminalOutputEmitter()
    const h1 = vi.fn()
    const h2 = vi.fn()

    emitter.on("session-1", h1)
    emitter.on("session-1", h2)
    emitter.emit("session-1", "data")

    expect(h1).toHaveBeenCalledWith("data")
    expect(h2).toHaveBeenCalledWith("data")
  })

  it("off() for unknown session does not throw", () => {
    const emitter = new TerminalOutputEmitter()
    expect(() => emitter.off("nope", vi.fn())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/desktop && npx vitest run src/renderer/src/terminal/terminal-output-emitter.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement the emitter**

Create `apps/desktop/src/renderer/src/terminal/terminal-output-emitter.ts`:

```typescript
export type OutputHandler = (chunk: string) => void

export class TerminalOutputEmitter {
  private handlers = new Map<string, Set<OutputHandler>>()

  on(sessionId: string, handler: OutputHandler): void {
    let set = this.handlers.get(sessionId)
    if (!set) {
      set = new Set()
      this.handlers.set(sessionId, set)
    }
    set.add(handler)
  }

  off(sessionId: string, handler: OutputHandler): void {
    const set = this.handlers.get(sessionId)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) this.handlers.delete(sessionId)
  }

  emit(sessionId: string, chunk: string): void {
    const set = this.handlers.get(sessionId)
    if (!set) return
    for (const handler of set) {
      handler(chunk)
    }
  }
}

export const terminalOutputEmitter = new TerminalOutputEmitter()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && npx vitest run src/renderer/src/terminal/terminal-output-emitter.test.ts
```
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/terminal/terminal-output-emitter.ts src/renderer/src/terminal/terminal-output-emitter.test.ts
git commit -m "feat: add TerminalOutputEmitter for session-scoped output routing"
```

---

### Task 4: Delete broken terminal-drawer test

**Files:**
- Delete: `apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx`

- [ ] **Step 1: Delete the orphaned test file**

The file `terminal-drawer.test.tsx` imports from `./TerminalDrawer.js` which was deleted (TerminalDrawer is now inline in ChatPageShell). Delete it:

```bash
rm apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/src/terminal/terminal-drawer.test.tsx
git commit -m "chore: remove orphaned TerminalDrawer test (component is now inline)"
```

---

## Chunk 2: Terminal workflows

### Task 5: Create terminal workflow functions

**Files:**
- Create: `apps/desktop/src/renderer/src/terminal/terminal-workflows.ts`
- Create: `apps/desktop/src/renderer/src/terminal/terminal-workflows.test.ts`

- [ ] **Step 1: Write failing tests for `openTerminal`**

Create `apps/desktop/src/renderer/src/terminal/terminal-workflows.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"

import { makeTerminalSession } from "../test-utils/factories.js"
import {
  closeTerminalSession,
  openTerminal,
  resizeTerminalSession,
  writeTerminalInput,
} from "./terminal-workflows.js"

const session = makeTerminalSession("term-1", "proj-1", "sb-1")

describe("openTerminal", () => {
  it("calls terminal.open and upserts the returned session", async () => {
    const actions = {
      upsertTerminalSession: vi.fn(),
      setFocusedTerminalSession: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
    }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(session),
    }

    const result = await openTerminal("proj-1", actions, client)

    expect(client.command).toHaveBeenCalledWith("terminal.open", {
      project_id: "proj-1",
    })
    expect(actions.upsertTerminalSession).toHaveBeenCalledWith("proj-1", session)
    expect(actions.setFocusedTerminalSession).toHaveBeenCalledWith(
      "proj-1",
      "term-1",
    )
    expect(actions.setTerminalDrawerOpen).toHaveBeenCalledWith("proj-1", true)
    expect(result).toEqual(session)
  })

  it("passes cols and rows when provided", async () => {
    const actions = {
      upsertTerminalSession: vi.fn(),
      setFocusedTerminalSession: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
    }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(session),
    }

    await openTerminal("proj-1", actions, client, { cols: 80, rows: 24 })

    expect(client.command).toHaveBeenCalledWith("terminal.open", {
      project_id: "proj-1",
      cols: 80,
      rows: 24,
    })
  })

  it("does not open drawer on error", async () => {
    const actions = {
      upsertTerminalSession: vi.fn(),
      setFocusedTerminalSession: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
    }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockRejectedValue(new Error("backend down")),
    }

    await expect(openTerminal("proj-1", actions, client)).rejects.toThrow(
      "backend down",
    )
    expect(actions.setTerminalDrawerOpen).not.toHaveBeenCalled()
  })
})

describe("closeTerminalSession", () => {
  it("calls close_session and refreshes session list", async () => {
    const remaining = [makeTerminalSession("term-2", "proj-1", "sb-1")]
    const actions = {
      setTerminalSessionsForProject: vi.fn(),
    }
    const client = {
      query: vi.fn().mockResolvedValue({ sessions: remaining }),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await closeTerminalSession("proj-1", "term-1", actions, client)

    expect(client.command).toHaveBeenCalledWith("terminal.close_session", {
      project_id: "proj-1",
      session_id: "term-1",
    })
    expect(client.query).toHaveBeenCalledWith("terminal.list_sessions", {
      project_id: "proj-1",
    })
    expect(actions.setTerminalSessionsForProject).toHaveBeenCalledWith(
      "proj-1",
      remaining,
    )
  })
})

describe("writeTerminalInput", () => {
  it("sends input to the backend", async () => {
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await writeTerminalInput("proj-1", "term-1", "ls\n", client)

    expect(client.command).toHaveBeenCalledWith("terminal.write_input", {
      project_id: "proj-1",
      session_id: "term-1",
      input: "ls\n",
    })
  })
})

describe("resizeTerminalSession", () => {
  it("sends resize to the backend", async () => {
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await resizeTerminalSession("proj-1", "term-1", 120, 40, client)

    expect(client.command).toHaveBeenCalledWith("terminal.resize_session", {
      project_id: "proj-1",
      session_id: "term-1",
      cols: 120,
      rows: 40,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/desktop && npx vitest run src/renderer/src/terminal/terminal-workflows.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement the workflows**

Create `apps/desktop/src/renderer/src/terminal/terminal-workflows.ts`:

```typescript
import { parseTerminalListSessionsResult, parseTerminalSessionSnapshot } from "@ultra/shared"
import type { TerminalSessionSnapshot } from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command">

type OpenTerminalActions = Pick<
  AppActions,
  "upsertTerminalSession" | "setFocusedTerminalSession" | "setTerminalDrawerOpen"
>

type CloseTerminalActions = Pick<
  AppActions,
  "setTerminalSessionsForProject"
>

export async function openTerminal(
  projectId: string,
  actions: OpenTerminalActions,
  client: WorkflowClient = ipcClient,
  opts?: { cols?: number; rows?: number },
): Promise<TerminalSessionSnapshot> {
  const payload: Record<string, unknown> = { project_id: projectId }
  if (opts?.cols) payload.cols = opts.cols
  if (opts?.rows) payload.rows = opts.rows

  const result = await client.command("terminal.open", payload)
  const session = parseTerminalSessionSnapshot(result)

  actions.upsertTerminalSession(projectId, session)
  actions.setFocusedTerminalSession(projectId, session.sessionId)
  actions.setTerminalDrawerOpen(projectId, true)

  return session
}

export async function closeTerminalSession(
  projectId: string,
  sessionId: string,
  actions: CloseTerminalActions,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("terminal.close_session", {
    project_id: projectId,
    session_id: sessionId,
  })

  const result = await client.query("terminal.list_sessions", {
    project_id: projectId,
  })
  const { sessions } = parseTerminalListSessionsResult(result)
  actions.setTerminalSessionsForProject(projectId, sessions)
}

export async function writeTerminalInput(
  projectId: string,
  sessionId: string,
  input: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("terminal.write_input", {
    project_id: projectId,
    session_id: sessionId,
    input,
  })
}

export async function resizeTerminalSession(
  projectId: string,
  sessionId: string,
  cols: number,
  rows: number,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("terminal.resize_session", {
    project_id: projectId,
    session_id: sessionId,
    cols,
    rows,
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && npx vitest run src/renderer/src/terminal/terminal-workflows.test.ts
```
Expected: PASS (all tests)

- [ ] **Step 5: Type-check**

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/terminal/terminal-workflows.ts src/renderer/src/terminal/terminal-workflows.test.ts
git commit -m "feat: add terminal workflow functions (open, close, write, resize)"
```

---

## Chunk 3: Terminal subscriptions and output bridge

### Task 6: Create terminal output subscription module

**Files:**
- Create: `apps/desktop/src/renderer/src/terminal/terminal-subscriptions.ts`

This module provides `subscribeToTerminalOutput` which subscribes to `terminal.output` for a specific session and routes chunks through the emitter. The project-level `terminal.sessions` subscription already exists in `App.tsx`'s `TerminalSessionsBridge` — we intentionally do NOT duplicate it here. The spec lists `subscribeToTerminalSessions` in this module, but since `TerminalSessionsBridge` already handles it with proper lifecycle management (subscribes when connected + project active), adding a second implementation would create ownership confusion.

- [ ] **Step 1: Write failing tests**

Create `apps/desktop/src/renderer/src/terminal/terminal-subscriptions.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"

import { terminalOutputEmitter } from "./terminal-output-emitter.js"
import { subscribeToTerminalOutput } from "./terminal-subscriptions.js"

describe("subscribeToTerminalOutput", () => {
  it("subscribes to terminal.output with correct params", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      subscribe: vi.fn().mockResolvedValue(unsubscribe),
    }

    await subscribeToTerminalOutput("proj-1", "term-1", client)

    expect(client.subscribe).toHaveBeenCalledWith(
      "terminal.output",
      { project_id: "proj-1", session_id: "term-1" },
      expect.any(Function),
    )
  })

  it("routes parsed output chunks through the emitter", async () => {
    let capturedListener: ((event: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn().mockImplementation((_name, _payload, listener) => {
        capturedListener = listener
        return Promise.resolve(vi.fn())
      }),
    }

    await subscribeToTerminalOutput("proj-1", "term-1", client)

    const handler = vi.fn()
    terminalOutputEmitter.on("term-1", handler)

    // Simulate a subscription event
    capturedListener?.({
      protocol_version: "1.0",
      subscription_id: "sub-1",
      event_name: "terminal.output",
      payload: {
        project_id: "proj-1",
        session_id: "term-1",
        sequence_number: 1,
        chunk: "hello world",
        occurred_at: "2026-03-14T00:00:00Z",
      },
    })

    expect(handler).toHaveBeenCalledWith("hello world")

    terminalOutputEmitter.off("term-1", handler)
  })

  it("returns the unsubscribe function from the client", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      subscribe: vi.fn().mockResolvedValue(unsubscribe),
    }

    const result = await subscribeToTerminalOutput("proj-1", "term-1", client)

    expect(result).toBe(unsubscribe)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/desktop && npx vitest run src/renderer/src/terminal/terminal-subscriptions.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement the subscription function**

Create `apps/desktop/src/renderer/src/terminal/terminal-subscriptions.ts`:

```typescript
import { parseTerminalOutputEvent } from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import { terminalOutputEmitter } from "./terminal-output-emitter.js"

type SubscribeClient = Pick<typeof ipcClient, "subscribe">

export async function subscribeToTerminalOutput(
  projectId: string,
  sessionId: string,
  client: SubscribeClient = ipcClient,
): Promise<() => Promise<void>> {
  return client.subscribe(
    "terminal.output",
    { project_id: projectId, session_id: sessionId },
    (event) => {
      const parsed = parseTerminalOutputEvent(event)
      terminalOutputEmitter.emit(
        parsed.payload.session_id,
        parsed.payload.chunk,
      )
    },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && npx vitest run src/renderer/src/terminal/terminal-subscriptions.test.ts
```
Expected: PASS (all 3 tests)

- [ ] **Step 5: Type-check**

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/terminal/terminal-subscriptions.ts src/renderer/src/terminal/terminal-subscriptions.test.ts
git commit -m "feat: add subscribeToTerminalOutput for session-scoped output routing"
```

---

## Chunk 4: TerminalPane component

### Task 7: Create TerminalPane xterm.js component

**Files:**
- Create: `apps/desktop/src/renderer/src/terminal/TerminalPane.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Add xterm CSS container styles**

In `apps/desktop/src/renderer/src/styles/app.css`, add after the existing `.terminal-drawer__panel` block:

```css
/* ── Terminal Pane (xterm.js) ────────────────────────────── */

.terminal-pane {
  width: 100%;
  height: 100%;
  position: relative;
}

.terminal-pane__xterm {
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 2: Implement TerminalPane**

Create `apps/desktop/src/renderer/src/terminal/TerminalPane.tsx`:

```tsx
import { FitAddon } from "@xterm/addon-fit"
import { useEffect, useRef } from "react"
import { Terminal } from "xterm"
import "xterm/css/xterm.css"

import { terminalOutputEmitter } from "./terminal-output-emitter.js"
import { subscribeToTerminalOutput } from "./terminal-subscriptions.js"

export function TerminalPane({
  sessionId,
  projectId,
  recentOutput,
  onInput,
  onResize,
}: {
  sessionId: string
  projectId: string
  recentOutput: string
  onInput: (sessionId: string, data: string) => void
  onResize: (sessionId: string, cols: number, rows: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let mounted = true

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#1a1d27",
        foreground: "#eef1f8",
        cursor: "#eef1f8",
        selectionBackground: "rgba(91, 141, 239, 0.3)",
        black: "#1a1d27",
        brightBlack: "#8494b0",
        white: "#eef1f8",
        brightWhite: "#ffffff",
        blue: "#5b8def",
        brightBlue: "#7aa5ff",
        cyan: "#6ee7b7",
        brightCyan: "#6ee7b7",
        green: "#6ee7b7",
        brightGreen: "#6ee7b7",
        red: "#fb7185",
        brightRed: "#fb7185",
        yellow: "#facc15",
        brightYellow: "#facc15",
        magenta: "#c084fc",
        brightMagenta: "#c084fc",
      },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    // Write buffered output for session continuity
    if (recentOutput) {
      terminal.write(recentOutput)
    }

    // Fit terminal to container and report size
    try {
      fitAddon.fit()
      onResize(sessionId, terminal.cols, terminal.rows)
    } catch {
      // fit() can throw if container has zero dimensions
    }

    // User keystrokes → backend
    const inputDisposable = terminal.onData((data) => {
      onInput(sessionId, data)
    })

    // Output from backend → xterm
    const outputHandler = (chunk: string) => {
      terminal.write(chunk)
    }
    terminalOutputEmitter.on(sessionId, outputHandler)

    // Subscribe to terminal.output for this session
    let unsubscribeOutput: (() => Promise<void>) | null = null
    void subscribeToTerminalOutput(projectId, sessionId).then((unsub) => {
      if (mounted) {
        unsubscribeOutput = unsub
      } else {
        void unsub()
      }
    })

    // ResizeObserver for container size changes
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit()
          onResize(sessionId, terminal.cols, terminal.rows)
        } catch {
          // Ignore fit errors on zero-dimension containers
        }
      }, 50)
    })
    resizeObserver.observe(container)

    terminalRef.current = terminal

    return () => {
      mounted = false
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      inputDisposable.dispose()
      terminalOutputEmitter.off(sessionId, outputHandler)
      terminal.dispose()
      terminalRef.current = null

      if (unsubscribeOutput) {
        void unsubscribeOutput()
      }
    }
  }, [sessionId, projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  // recentOutput, onInput, onResize are intentionally excluded —
  // the effect runs once per session mount and captures initial values.

  return (
    <div className="terminal-pane">
      <div className="terminal-pane__xterm" ref={containerRef} />
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/terminal/TerminalPane.tsx src/renderer/src/styles/app.css
git commit -m "feat: add TerminalPane xterm.js component with fit addon and output routing"
```

---

## Chunk 5: Wire components

### Task 8: Wire TerminalPane into ChatPageShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPageShell.tsx`

Replace the `<pre>` output placeholder with `<TerminalPane>`, add "+" and "×" buttons on tabs, and wire workflow functions.

- [ ] **Step 1: Add imports**

At the top of `ChatPageShell.tsx`, add:

```typescript
import { TerminalPane } from "../terminal/TerminalPane.js"
import {
  closeTerminalSession,
  openTerminal,
  writeTerminalInput,
  resizeTerminalSession,
} from "../terminal/terminal-workflows.js"
```

- [ ] **Step 2: Add workflow handler functions**

Inside the `ChatPageShell` component, add these handlers alongside the existing ones:

```typescript
function handleOpenTerminal() {
  if (!activeProjectId) return
  void openTerminal(activeProjectId, actions)
}

function handleCloseSession(sessionId: string) {
  if (!activeProjectId) return
  void closeTerminalSession(activeProjectId, sessionId, actions)
}

function handleTerminalInput(sessionId: string, data: string) {
  if (!activeProjectId) return
  void writeTerminalInput(activeProjectId, sessionId, data)
}

function handleTerminalResize(sessionId: string, cols: number, rows: number) {
  if (!activeProjectId) return
  void resizeTerminalSession(activeProjectId, sessionId, cols, rows)
}
```

- [ ] **Step 3: Replace the `<pre>` output block in TerminalDrawer**

**Important:** TerminalDrawer already has an `onResize: (height: number) => void` prop for the drawer drag handle. To avoid a naming collision, pass `onTerminalInput` and `onTerminalResize` as separate props to TerminalDrawer, which passes them through to TerminalPane.

Add to TerminalDrawer's prop type:
```typescript
onTerminalInput: (sessionId: string, data: string) => void
onTerminalResize: (sessionId: string, cols: number, rows: number) => void
```

In the `<TerminalDrawer>` JSX in ChatPageShell, add:
```tsx
onTerminalInput={handleTerminalInput}
onTerminalResize={handleTerminalResize}
```

In the TerminalDrawer component's panel section, replace:

```tsx
<div className="terminal-drawer__panel">
  {focusedSession ? (
    <pre className="terminal-drawer__output">
      {focusedSession.recentOutput ||
        "Session output will appear here once activity is available."}
    </pre>
  ) : (
    <p className="terminal-drawer__placeholder">
      Terminal sessions will appear here
    </p>
  )}
</div>
```

With:

```tsx
<div className="terminal-drawer__panel">
  {focusedSession ? (
    <TerminalPane
      key={focusedSession.sessionId}
      sessionId={focusedSession.sessionId}
      projectId={focusedSession.projectId}
      recentOutput={focusedSession.recentOutput}
      onInput={onTerminalInput}
      onResize={onTerminalResize}
    />
  ) : (
    <p className="terminal-drawer__placeholder">
      Terminal sessions will appear here
    </p>
  )}
</div>
```

- [ ] **Step 5: Add "+" button to tab bar**

In the TerminalDrawer's tab list section (`terminal-drawer__tabs`), after the session tabs loop, add a "+" button:

```tsx
<button
  className="terminal-drawer__tab terminal-drawer__tab--new"
  type="button"
  onClick={onNewSession}
  aria-label="New terminal session"
>
  +
</button>
```

Add `onNewSession` to TerminalDrawer props:
```typescript
onNewSession: () => void
```

Wire in ChatPageShell:
```tsx
onNewSession={handleOpenTerminal}
```

- [ ] **Step 6: Add "×" close button on each session tab**

In the TerminalDrawer's session tab buttons, add a close button inside each tab:

```tsx
<button
  key={session.sessionId}
  className={`terminal-drawer__tab ${session.sessionId === focusedSession?.sessionId ? "terminal-drawer__tab--active" : ""}`}
  type="button"
  role="tab"
  aria-selected={session.sessionId === focusedSession?.sessionId}
  onClick={() => onFocusSession(session.sessionId)}
>
  {session.title}
  <small>{session.status}</small>
  <span
    className="terminal-drawer__tab-close"
    role="button"
    tabIndex={0}
    aria-label={`Close ${session.title}`}
    onClick={(e) => {
      e.stopPropagation()
      onCloseSession(session.sessionId)
    }}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation()
        onCloseSession(session.sessionId)
      }
    }}
  >
    ×
  </span>
</button>
```

Add `onCloseSession` to TerminalDrawer props:
```typescript
onCloseSession: (sessionId: string) => void
```

Wire in ChatPageShell:
```tsx
onCloseSession={handleCloseSession}
```

- [ ] **Step 7: Always show tab bar (even with 1 session) when drawer is open**

Change the condition `sessions.length > 1` to `sessions.length > 0` so the tab bar (with the + button) is always visible when there are sessions:

```tsx
{sessions.length > 0 && (
  <div className="terminal-drawer__tabs" role="tablist">
    {/* session tabs... */}
    {/* + button... */}
  </div>
)}
```

- [ ] **Step 8: Add CSS for new tab elements**

In `apps/desktop/src/renderer/src/styles/app.css`, add after the existing terminal drawer styles:

```css
.terminal-drawer__tab--new {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 1rem;
  text-align: center;
}

.terminal-drawer__tab--new:hover {
  color: var(--text-primary);
  background: rgba(148, 163, 200, 0.08);
}

.terminal-drawer__tab-close {
  margin-left: auto;
  padding: 0 2px;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
  line-height: 1;
  border-radius: 3px;
}

.terminal-drawer__tab-close:hover {
  color: var(--text-primary);
  background: rgba(148, 163, 200, 0.12);
}
```

- [ ] **Step 9: Type-check**

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```
Expected: clean

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/pages/ChatPageShell.tsx src/renderer/src/styles/app.css
git commit -m "feat: wire TerminalPane into ChatPageShell with tab +/× and workflow handlers"
```

---

### Task 9: Wire AppShell TitleBar toggle to `openTerminal`

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/AppShell.tsx`

The TitleBar toggle button and keyboard shortcut should use `openTerminal` when no sessions exist, and toggle drawer visibility when sessions already exist.

- [ ] **Step 1: Add import**

```typescript
import { openTerminal } from "../terminal/terminal-workflows.js"
```

- [ ] **Step 2: Update the toggle handler**

Find the `handleToggleTerminal` function. Update the logic so that:

- If the drawer is closed AND no terminal sessions exist for the project, call `openTerminal` (which creates a session and opens the drawer)
- Otherwise, toggle the drawer visibility as before

```typescript
function handleToggleTerminal() {
  if (!activeProjectId) return
  const isOpen = terminal.drawerOpenByProjectId[activeProjectId] ?? false
  const hasSessions = (terminal.sessionsByProjectId[activeProjectId] ?? []).length > 0

  if (!isOpen && !hasSessions) {
    // First open: create a session via backend
    void openTerminal(activeProjectId, actions)
  } else {
    actions.setTerminalDrawerOpen(activeProjectId, !isOpen)
  }
}
```

- [ ] **Step 3: Update the keyboard shortcut to call `handleToggleTerminal`**

In the `useEffect` that handles the `keydown` event for `Cmd/Ctrl+``, replace the inline toggle logic:

```typescript
// Before:
const isOpen = terminal.drawerOpenByProjectId[activeProjectId] ?? false
actions.setTerminalDrawerOpen(activeProjectId, !isOpen)

// After:
handleToggleTerminal()
```

This ensures both TitleBar button and keyboard shortcut share the same open-or-toggle logic.

- [ ] **Step 4: Type-check**

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AppShell.tsx
git commit -m "feat: wire TitleBar terminal toggle to openTerminal workflow"
```

---

### Task 10: Final verification

- [ ] **Step 1: Type-check entire project**

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```
Expected: clean

- [ ] **Step 2: Run all tests**

```bash
cd apps/desktop && npx vitest run
```
Expected: New tests pass. Pre-existing failures (react-dom/server in SSR tests) are unrelated.

- [ ] **Step 3: Commit any remaining changes and verify clean working tree**

```bash
git status
```
Expected: clean (all changes committed in prior tasks)
