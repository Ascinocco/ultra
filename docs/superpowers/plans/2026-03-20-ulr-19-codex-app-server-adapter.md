# ULR-19 Sub-Project 2: Codex App-Server Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI-spawn Codex adapter with a long-lived `codex app-server` JSON-RPC process for real-time streaming.

**Architecture:** Spawn `codex app-server` as a persistent child process communicating via JSON-RPC over stdin/stdout pipes. A `JsonRpcClient` utility handles request/response pairing and notification dispatch. The adapter manages one app-server process per chat, with session resumption via `thread/resume`. Streaming notifications (`item/agentMessage/delta`) emit `assistant_delta` events via `request.onEvent` in real-time.

**Tech Stack:** Node.js child_process, readline, JSON-RPC 2.0, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-runtime-adapter-streaming-design.md` (Sub-Project 2)

**Reference:** `vendor/t3code/apps/server/src/codexAppServerManager.ts`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `apps/backend/src/chats/runtime/json-rpc-client.ts` | Generic JSON-RPC 2.0 client over stdin/stdout |
| `apps/backend/src/chats/runtime/json-rpc-client.test.ts` | Unit tests for JSON-RPC client |
| `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts` | Rewrite: app-server-based runTurn, event mapping |
| `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.test.ts` | Rewrite: tests against mock app-server |
| `apps/backend/src/index.ts` | Update adapter construction |

---

### Task 1: JsonRpcClient Utility

**Files:**
- Create: `apps/backend/src/chats/runtime/json-rpc-client.ts`
- Create: `apps/backend/src/chats/runtime/json-rpc-client.test.ts`

This is a generic JSON-RPC 2.0 client that communicates over a child process's stdin/stdout. It handles:
- Sending requests (with ID) and waiting for matching responses
- Sending notifications (no ID, no response)
- Receiving server notifications (dispatched to handler)
- Receiving server requests (for approvals — dispatched to handler)
- Responding to server requests
- Timeout on unresponsive requests

- [ ] **Step 1: Write failing tests**

```ts
// json-rpc-client.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { JsonRpcClient } from "./json-rpc-client.js"
import { EventEmitter, Readable, Writable } from "node:stream"
import { createInterface } from "node:readline"

// Helper: create a fake child process with controllable stdin/stdout
function createFakeProcess() {
  const stdinChunks: string[] = []
  const stdout = new Readable({ read() {} })

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinChunks.push(chunk.toString())
      callback()
    },
  })

  return {
    stdin,
    stdout,
    stdinChunks,
    // Push a JSON-RPC message from "server" to "client"
    pushServerMessage(msg: any) {
      stdout.push(JSON.stringify(msg) + "\n")
    },
    end() {
      stdout.push(null)
    },
  }
}

describe("JsonRpcClient", () => {
  it("sends a request and resolves with matching response", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    // Start request
    const resultPromise = client.request("initialize", { clientInfo: { name: "test" } })

    // Simulate server response after a tick
    await new Promise((r) => setTimeout(r, 10))
    const sentMsg = JSON.parse(proc.stdinChunks[0])
    expect(sentMsg.method).toBe("initialize")
    expect(sentMsg.id).toBeDefined()

    proc.pushServerMessage({ id: sentMsg.id, result: { ok: true } })

    const result = await resultPromise
    expect(result).toEqual({ ok: true })

    client.destroy()
  })

  it("sends a notification (no response expected)", () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    client.notify("initialized")

    const sent = JSON.parse(proc.stdinChunks[0])
    expect(sent.method).toBe("initialized")
    expect(sent.id).toBeUndefined()

    client.destroy()
  })

  it("dispatches server notifications to handler", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)
    const notifications: any[] = []

    client.onNotification((method, params) => {
      notifications.push({ method, params })
    })

    proc.pushServerMessage({ method: "item/agentMessage/delta", params: { delta: "Hello" } })
    await new Promise((r) => setTimeout(r, 20))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toEqual({
      method: "item/agentMessage/delta",
      params: { delta: "Hello" },
    })

    client.destroy()
  })

  it("dispatches server requests to handler and allows responding", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    client.onRequest((id, method, params) => {
      client.respond(id, { decision: "approved" })
    })

    proc.pushServerMessage({
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: { command: "ls" },
    })
    await new Promise((r) => setTimeout(r, 20))

    // Check that response was sent
    const response = JSON.parse(proc.stdinChunks[0])
    expect(response.id).toBe(42)
    expect(response.result).toEqual({ decision: "approved" })

    client.destroy()
  })

  it("rejects request on error response", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    const resultPromise = client.request("thread/start", {})

    await new Promise((r) => setTimeout(r, 10))
    const sentMsg = JSON.parse(proc.stdinChunks[0])

    proc.pushServerMessage({
      id: sentMsg.id,
      error: { code: -32601, message: "Method not found" },
    })

    await expect(resultPromise).rejects.toThrow("Method not found")

    client.destroy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/chats/runtime/json-rpc-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JsonRpcClient**

```ts
// json-rpc-client.ts
import { createInterface, type Interface as ReadlineInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"

type PendingRequest = {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type NotificationHandler = (method: string, params: unknown) => void
type RequestHandler = (id: string | number, method: string, params: unknown) => void

const DEFAULT_TIMEOUT_MS = 20_000

export class JsonRpcClient {
  private nextId = 1
  private pending = new Map<string, PendingRequest>()
  private notificationHandler: NotificationHandler | null = null
  private requestHandler: RequestHandler | null = null
  private rl: ReadlineInterface
  private stdin: Writable
  private destroyed = false

  constructor(stdin: Writable, stdout: Readable, private timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.stdin = stdin
    this.rl = createInterface({ input: stdout })
    this.rl.on("line", (line) => this.handleLine(line))
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = String(this.nextId++)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`JSON-RPC request "${method}" timed out after ${this.timeoutMs}ms`))
      }, this.timeoutMs)

      this.pending.set(id, { resolve, reject, timeout })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, params })
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: string | number, code: number, message: string): void {
    this.write({ id, error: { code, message } })
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.rl.close()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("JsonRpcClient destroyed"))
    }
    this.pending.clear()
  }

  private write(message: Record<string, unknown>): void {
    if (this.destroyed) return
    this.stdin.write(JSON.stringify(message) + "\n")
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }

    if (typeof parsed !== "object" || parsed === null) return

    // Response to our request (has id, no method)
    if ("id" in parsed && !("method" in parsed)) {
      const pending = this.pending.get(String(parsed.id))
      if (pending) {
        this.pending.delete(String(parsed.id))
        clearTimeout(pending.timeout)
        if (parsed.error) {
          pending.reject(new Error(parsed.error.message ?? `JSON-RPC error ${parsed.error.code}`))
        } else {
          pending.resolve(parsed.result)
        }
      }
      return
    }

    // Server request (has id AND method)
    if ("id" in parsed && "method" in parsed) {
      this.requestHandler?.(parsed.id, parsed.method, parsed.params)
      return
    }

    // Notification (has method, no id)
    if ("method" in parsed && !("id" in parsed)) {
      this.notificationHandler?.(parsed.method, parsed.params)
      return
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/chats/runtime/json-rpc-client.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/chats/runtime/json-rpc-client.ts apps/backend/src/chats/runtime/json-rpc-client.test.ts
git commit -m "feat(ulr-19): add JsonRpcClient utility for Codex app-server protocol"
```

---

### Task 2: Rewrite Codex Adapter with App-Server

**Files:**
- Modify: `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts` (full rewrite)

The adapter changes from spawning `codex exec` per turn to managing a long-lived `codex app-server` process per chat.

- [ ] **Step 1: Read the current adapter fully**

Read `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts` to understand all code being replaced.

- [ ] **Step 2: Rewrite the adapter**

Key design points:
- Each `runTurn` call: get or create an app-server session for the chat, send `turn/start`, collect streaming notifications until `turn/completed`
- The `spawnFn` is injectable for testing (like Claude's `queryFn`)
- Map JSON-RPC notifications to `ChatRuntimeEvent` types:
  - `item/agentMessage/delta` → `assistant_delta`
  - `item/started` / `item/completed` → `tool_activity`
  - `item/commandExecution/outputDelta` → `tool_activity`
  - `turn/completed` → signals turn end, collect final text
  - Approval requests → auto-respond `{ decision: "approved" }`
- Session lifecycle: spawn + initialize + thread/start on first turn, reuse process + thread/resume on subsequent turns
- On process crash: destroy session, next turn auto-recreates
- AbortSignal: send `turn/interrupt` JSON-RPC request

The adapter should maintain a `Map<string, CodexSession>` internally (like the Claude adapter managed sessions before we simplified).

```ts
type CodexSession = {
  child: ChildProcess
  rpcClient: JsonRpcClient
  providerThreadId: string
  stopped: boolean
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit (adapter only — tests come next)**

```bash
git add apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts
git commit -m "feat(ulr-19): rewrite Codex adapter to use app-server JSON-RPC"
```

---

### Task 3: Rewrite Codex Adapter Tests

**Files:**
- Modify: `apps/backend/src/chats/runtime/codex-chat-runtime-adapter.test.ts` (full rewrite)

Tests should mock the `codex app-server` child process by providing a fake stdin/stdout that simulates JSON-RPC messages.

Key test scenarios:
1. **Streaming text deltas** — `item/agentMessage/delta` notifications emit `assistant_delta` via `onEvent`
2. **Batch path** — works without `onEvent`
3. **Approval auto-response** — server request gets `{ decision: "approved" }` response
4. **Turn completion** — `turn/completed` resolves the turn with collected events
5. **Error handling** — process crash or RPC error handled gracefully
6. **Session reuse** — second `runTurn` reuses same process (app-server not re-spawned)
7. **Thread ID extraction** — `vendorSessionId` captured from `thread/started` notification

- [ ] **Step 1: Write tests**

Use a mock that simulates the codex app-server: fake child process with Writable stdin and Readable stdout. The test drives the "server side" by pushing JSON-RPC messages to the readable stream.

- [ ] **Step 2: Run tests**

Run: `cd apps/backend && npx vitest run src/chats/runtime/codex-chat-runtime-adapter.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit adapter + tests together**

```bash
git add apps/backend/src/chats/runtime/codex-chat-runtime-adapter.ts apps/backend/src/chats/runtime/codex-chat-runtime-adapter.test.ts
git commit -m "feat(ulr-19): rewrite Codex adapter tests for app-server JSON-RPC"
```

---

### Task 4: Update Adapter Registration

**Files:**
- Modify: `apps/backend/src/index.ts`

- [ ] **Step 1: Update the Codex adapter construction**

Change from:
```ts
new CodexChatRuntimeAdapter(chatRuntimeProcessRunner),
```
To:
```ts
new CodexChatRuntimeAdapter({
  codexBinaryPath: "codex",
}),
```

If `chatRuntimeProcessRunner` is no longer used by any adapter, remove it.

- [ ] **Step 2: Run full backend tests**

Run: `cd apps/backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(ulr-19): update Codex adapter registration for app-server mode"
```

---

### Task 5: End-to-End Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Start dev server and test with Codex chat**

Run: `pnpm dev`

Create or open a chat configured with Codex provider. Send "Hello world."

Verify:
- Typing indicator appears
- Text streams in real-time (token-by-token if Codex supports delta notifications)
- Turn completes and final message appears
- Follow-up question works (session reuse)
- No duplicate text

- [ ] **Step 3: Test error recovery**

Kill the codex app-server process manually and send another message — verify the adapter recreates the session.

- [ ] **Step 4: Final commit if cleanup needed**

```bash
git add -A
git commit -m "chore(ulr-19): Codex app-server adapter end-to-end cleanup"
```
