# ULR-19 Sub-Project 1: Claude SDK Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI-spawn Claude adapter with `@anthropic-ai/claude-agent-sdk` for real-time streaming of assistant responses.

**Architecture:** The adapter uses the SDK's `query()` function which returns an `AsyncIterable<SDKMessage>`. A session manager maintains one SDK session per chat. Each `runTurn` call queues a user message to the session's prompt stream and consumes SDK messages as they arrive, mapping them to `ChatRuntimeEvent` objects and emitting via `onEvent`.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk`, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-runtime-adapter-streaming-design.md`

**Worktree:** Create a new worktree for this work (branch: `feat/ulr-19-claude-sdk-adapter`)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `apps/backend/src/chats/runtime/claude-session-manager.ts` | Manages SDK sessions per chat (create, reuse, destroy) |
| `apps/backend/src/chats/runtime/claude-session-manager.test.ts` | Unit tests for session lifecycle |
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` | Rewrite: SDK-based runTurn, event mapping |
| `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.test.ts` | Rewrite: tests against mock SDK |
| `apps/backend/src/chats/runtime/types.ts` | Make `diagnostics` optional on `ChatRuntimeTurnResult` |
| `apps/backend/src/index.ts` | Update adapter construction |
| `apps/backend/package.json` | Add `@anthropic-ai/claude-agent-sdk` dependency |

---

### Task 1: Add SDK Dependency and Make `diagnostics` Optional

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/src/chats/runtime/types.ts:63-69`

- [ ] **Step 1: Install the SDK**

```bash
cd apps/backend && pnpm add @anthropic-ai/claude-agent-sdk@^0.2.77
```

- [ ] **Step 2: Make `diagnostics` optional on `ChatRuntimeTurnResult`**

In `apps/backend/src/chats/runtime/types.ts`, change line 67:

```ts
// From:
diagnostics: RuntimeProcessResult
// To:
diagnostics?: RuntimeProcessResult
```

- [ ] **Step 3: Verify the project compiles**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No new errors (existing code that accesses `diagnostics` may need optional chaining — check and fix if needed)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/package.json pnpm-lock.yaml apps/backend/src/chats/runtime/types.ts
git commit -m "feat(ulr-19): add claude-agent-sdk dependency and make diagnostics optional"
```

---

### Task 2: Claude Session Manager

**Files:**
- Create: `apps/backend/src/chats/runtime/claude-session-manager.ts`
- Create: `apps/backend/src/chats/runtime/claude-session-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// claude-session-manager.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { ClaudeSessionManager } from "./claude-session-manager.js"
import type { ClaudeSessionContext, ClaudeSessionConfig } from "./claude-session-manager.js"

// Mock the SDK query function
function createMockQuery() {
  const messages: unknown[] = []
  const iterator = {
    [Symbol.asyncIterator]() { return this },
    async next() { return { done: true, value: undefined } },
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    setMaxThinkingTokens: vi.fn(async () => {}),
    close: vi.fn(),
  }
  return { iterator, messages }
}

describe("ClaudeSessionManager", () => {
  let manager: ClaudeSessionManager
  const mockCreateQuery = vi.fn()

  beforeEach(() => {
    mockCreateQuery.mockReset()
    mockCreateQuery.mockReturnValue(createMockQuery().iterator)
    manager = new ClaudeSessionManager({
      pathToClaudeCodeExecutable: "claude",
      createQuery: mockCreateQuery,
    })
  })

  it("creates a new session on first getOrCreate", () => {
    const session = manager.getOrCreate("chat_1", {
      cwd: "/tmp",
      model: "claude-sonnet-4-6",
      permissionLevel: "full_access",
    })
    expect(session).toBeDefined()
    expect(session.chatId).toBe("chat_1")
    expect(mockCreateQuery).toHaveBeenCalledOnce()
  })

  it("reuses existing session on second getOrCreate", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    const session1 = manager.getOrCreate("chat_1", config)
    const session2 = manager.getOrCreate("chat_1", config)
    expect(session1).toBe(session2)
    expect(mockCreateQuery).toHaveBeenCalledOnce()
  })

  it("creates separate sessions for different chats", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    const session1 = manager.getOrCreate("chat_1", config)
    const session2 = manager.getOrCreate("chat_2", config)
    expect(session1).not.toBe(session2)
    expect(mockCreateQuery).toHaveBeenCalledTimes(2)
  })

  it("destroy removes the session", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    const session = manager.getOrCreate("chat_1", config)
    manager.destroy("chat_1")
    // Next getOrCreate should create a new session
    const session2 = manager.getOrCreate("chat_1", config)
    expect(session2).not.toBe(session)
    expect(mockCreateQuery).toHaveBeenCalledTimes(2)
  })

  it("destroyAll removes all sessions", () => {
    const config = { cwd: "/tmp", model: "claude-sonnet-4-6", permissionLevel: "full_access" as const }
    manager.getOrCreate("chat_1", config)
    manager.getOrCreate("chat_2", config)
    manager.destroyAll()
    // Both should create new sessions
    manager.getOrCreate("chat_1", config)
    manager.getOrCreate("chat_2", config)
    expect(mockCreateQuery).toHaveBeenCalledTimes(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/chats/runtime/claude-session-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the session manager**

```ts
// claude-session-manager.ts
import {
  query,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
  type SDKUserMessage,
  type CanUseTool,
} from "@anthropic-ai/claude-agent-sdk"
import { randomUUID } from "node:crypto"

export type ClaudeSessionConfig = {
  cwd: string
  model: string
  permissionLevel: string
  thinkingLevel?: string
  vendorSessionId?: string | null
}

export type ClaudeQueryRuntime = AsyncIterable<SDKMessage> & {
  readonly interrupt: () => Promise<void>
  readonly setModel: (model?: string) => Promise<void>
  readonly setPermissionMode: (mode: string) => Promise<void>
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>
  readonly close: () => void
}

type CreateQueryFn = (input: {
  readonly prompt: AsyncIterable<SDKUserMessage>
  readonly options: ClaudeQueryOptions
}) => ClaudeQueryRuntime

export type ClaudeSessionContext = {
  chatId: string
  queryRuntime: ClaudeQueryRuntime
  promptQueue: SDKUserMessage[]
  promptResolve: ((value: IteratorResult<SDKUserMessage>) => void) | null
  vendorSessionId: string
  stopped: boolean
}

export type ClaudeSessionManagerConfig = {
  pathToClaudeCodeExecutable?: string
  defaultEnv?: NodeJS.ProcessEnv
  createQuery?: CreateQueryFn
}

export class ClaudeSessionManager {
  private sessions = new Map<string, ClaudeSessionContext>()
  private createQueryFn: CreateQueryFn
  private config: ClaudeSessionManagerConfig

  constructor(config: ClaudeSessionManagerConfig = {}) {
    this.config = config
    this.createQueryFn = config.createQuery ?? ((input) =>
      query({ prompt: input.prompt, options: input.options }) as ClaudeQueryRuntime
    )
  }

  getOrCreate(chatId: string, sessionConfig: ClaudeSessionConfig): ClaudeSessionContext {
    const existing = this.sessions.get(chatId)
    if (existing && !existing.stopped) {
      return existing
    }

    const vendorSessionId = sessionConfig.vendorSessionId ?? randomUUID()

    // Build an async iterable prompt stream that we can push messages to
    const pendingMessages: SDKUserMessage[] = []
    let waitingResolve: ((value: IteratorResult<SDKUserMessage>) => void) | null = null
    let done = false

    const promptIterable: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            if (pendingMessages.length > 0) {
              return Promise.resolve({ done: false, value: pendingMessages.shift()! })
            }
            if (done) {
              return Promise.resolve({ done: true, value: undefined })
            }
            return new Promise((resolve) => {
              waitingResolve = resolve
            })
          },
          return(): Promise<IteratorResult<SDKUserMessage>> {
            done = true
            return Promise.resolve({ done: true, value: undefined })
          },
        }
      },
    }

    const permissionMode = this.mapPermissionMode(sessionConfig.permissionLevel)

    const queryOptions: ClaudeQueryOptions = {
      cwd: sessionConfig.cwd,
      model: sessionConfig.model,
      pathToClaudeCodeExecutable: this.config.pathToClaudeCodeExecutable ?? "claude",
      permissionMode,
      includePartialMessages: true,
      canUseTool: this.buildCanUseTool(sessionConfig.permissionLevel),
      env: this.config.defaultEnv ?? process.env,
      ...(sessionConfig.vendorSessionId
        ? { resume: sessionConfig.vendorSessionId }
        : { sessionId: vendorSessionId }),
      ...(permissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
    }

    const queryRuntime = this.createQueryFn({
      prompt: promptIterable,
      options: queryOptions,
    })

    const context: ClaudeSessionContext = {
      chatId,
      queryRuntime,
      promptQueue: pendingMessages,
      promptResolve: null,
      vendorSessionId,
      stopped: false,
    }

    // Wire the prompt push mechanism
    const originalPush = pendingMessages.push.bind(pendingMessages)
    context.promptQueue = new Proxy(pendingMessages, {
      get(target, prop) {
        if (prop === "push") {
          return (...items: SDKUserMessage[]) => {
            const result = originalPush(...items)
            if (waitingResolve && pendingMessages.length > 0) {
              const resolve = waitingResolve
              waitingResolve = null
              resolve({ done: false, value: pendingMessages.shift()! })
            }
            return result
          }
        }
        return Reflect.get(target, prop)
      },
    })

    this.sessions.set(chatId, context)
    return context
  }

  destroy(chatId: string): void {
    const context = this.sessions.get(chatId)
    if (context) {
      context.stopped = true
      context.queryRuntime.close()
      this.sessions.delete(chatId)
    }
  }

  destroyAll(): void {
    for (const [chatId] of this.sessions) {
      this.destroy(chatId)
    }
  }

  private mapPermissionMode(permissionLevel: string): string {
    switch (permissionLevel) {
      case "full_access":
        return "bypassPermissions"
      case "supervised":
        return "default"
      default:
        return "default"
    }
  }

  private buildCanUseTool(permissionLevel: string): CanUseTool {
    if (permissionLevel === "full_access") {
      return async () => ({ allowed: true as const })
    }
    // Supervised mode — for now, auto-approve (ULR-34 will wire the UI)
    return async () => ({ allowed: true as const })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/chats/runtime/claude-session-manager.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/chats/runtime/claude-session-manager.ts apps/backend/src/chats/runtime/claude-session-manager.test.ts
git commit -m "feat(ulr-19): add ClaudeSessionManager for SDK session lifecycle"
```

---

### Task 3: Rewrite Claude Adapter with SDK

**Files:**
- Modify: `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` (full rewrite of internals)

This is the core task. The adapter's `runTurn` method changes from "spawn CLI and parse stdout" to "push message to SDK session and consume async iterable."

- [ ] **Step 1: Read the current adapter fully**

Read `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts` to understand all the code that will be replaced.

- [ ] **Step 2: Rewrite the adapter**

Replace the entire file with the SDK-based implementation:

```ts
// claude-chat-runtime-adapter.ts
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeSessionManager, type ClaudeSessionManagerConfig } from "./claude-session-manager.js"
import type {
  ChatRuntimeAdapter,
  ChatRuntimeEvent,
  ChatRuntimeTurnRequest,
  ChatRuntimeTurnResult,
} from "./types.js"

/**
 * Maps an SDK message to zero or more ChatRuntimeEvent objects.
 * Only maps events we care about — text deltas, tool activity, final result, errors.
 */
function mapSdkMessage(message: SDKMessage): {
  events: ChatRuntimeEvent[]
  finalText?: string
  vendorSessionId?: string
} {
  const events: ChatRuntimeEvent[] = []
  let finalText: string | undefined
  let vendorSessionId: string | undefined

  // Extract session ID from any message that carries it
  if ("session_id" in message && typeof message.session_id === "string") {
    vendorSessionId = message.session_id
  }

  if (message.type === "content_block_delta") {
    const delta = (message as any).delta
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      events.push({ type: "assistant_delta", text: delta.text })
    } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      events.push({ type: "runtime_notice", message: delta.thinking })
    }
  } else if (message.type === "content_block_start") {
    const block = (message as any).content_block
    if (block?.type === "tool_use" && typeof block.name === "string") {
      events.push({
        type: "tool_activity",
        label: block.name,
        metadata: { id: block.id },
      })
    }
  } else if (message.type === "result") {
    const resultMessage = message as any
    // Extract final text from the result's message content
    if (resultMessage.message?.content && Array.isArray(resultMessage.message.content)) {
      const textParts = resultMessage.message.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
      finalText = textParts.join("")
    }
    if (resultMessage.session_id) {
      vendorSessionId = resultMessage.session_id
    }
    // Check for errors
    if (resultMessage.is_error || resultMessage.subtype === "error") {
      const errorText = resultMessage.error?.message ?? "Unknown SDK error"
      events.push({ type: "runtime_error", message: errorText })
    }
  }

  return { events, finalText, vendorSessionId }
}

export class ClaudeChatRuntimeAdapter implements ChatRuntimeAdapter {
  readonly provider = "claude" as const
  private sessionManager: ClaudeSessionManager

  constructor(config: ClaudeSessionManagerConfig = {}) {
    this.sessionManager = new ClaudeSessionManager(config)
  }

  async runTurn(request: ChatRuntimeTurnRequest): Promise<ChatRuntimeTurnResult> {
    const session = this.sessionManager.getOrCreate(request.chatId, {
      cwd: request.cwd,
      model: request.config.model,
      permissionLevel: request.config.permissionLevel,
      thinkingLevel: request.config.thinkingLevel,
      vendorSessionId: request.vendorSessionId,
    })

    // Build the user message
    const userMessage = {
      role: "user" as const,
      content: request.prompt,
    }

    // Push user message to the session's prompt stream
    session.promptQueue.push(userMessage as any)

    // Consume SDK messages
    const collectedEvents: ChatRuntimeEvent[] = []
    let finalText = ""
    let vendorSessionId: string | null = session.vendorSessionId
    const deltas: string[] = []

    // Wire abort signal
    let abortHandler: (() => void) | undefined
    if (request.signal) {
      abortHandler = () => {
        session.queryRuntime.interrupt().catch(() => {})
        session.stopped = true
      }
      if (request.signal.aborted) {
        abortHandler()
      } else {
        request.signal.addEventListener("abort", abortHandler, { once: true })
      }
    }

    // IMPORTANT: Do NOT use `for await` — it calls iterator.return() on break,
    // which terminates the SDK stream permanently. Use manual .next() calls instead
    // so the session can be reused across turns.
    const iterator = session.queryRuntime[Symbol.asyncIterator]()

    try {
      while (!session.stopped) {
        const { done, value: message } = await iterator.next()
        if (done || !message) break

        const mapped = mapSdkMessage(message)

        for (const event of mapped.events) {
          collectedEvents.push(event)
          request.onEvent?.(event)

          if (event.type === "assistant_delta") {
            deltas.push(event.text)
          }
        }

        if (mapped.finalText) {
          finalText = mapped.finalText
        }
        if (mapped.vendorSessionId) {
          vendorSessionId = mapped.vendorSessionId
          session.vendorSessionId = mapped.vendorSessionId
        }

        // Result message means this turn is done
        if (message.type === "result") {
          break
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorEvent: ChatRuntimeEvent = { type: "runtime_error", message: errorMessage }
      collectedEvents.push(errorEvent)
      request.onEvent?.(errorEvent)

      // Destroy session on error — will be recreated on next turn
      this.sessionManager.destroy(request.chatId)
    } finally {
      if (request.signal && abortHandler) {
        request.signal.removeEventListener("abort", abortHandler)
      }
    }

    // Fall back to joining deltas if no explicit finalText
    if (!finalText && deltas.length > 0) {
      finalText = deltas.join("")
    }

    // Add the assistant_final event
    if (finalText) {
      const finalEvent: ChatRuntimeEvent = { type: "assistant_final", text: finalText }
      collectedEvents.push(finalEvent)
      request.onEvent?.(finalEvent)
    }

    return {
      events: collectedEvents,
      finalText,
      vendorSessionId,
      resumed: request.vendorSessionId !== null,
    }
  }

  /**
   * Destroy all sessions (called on backend shutdown).
   */
  shutdown(): void {
    this.sessionManager.destroyAll()
  }
}
```

- [ ] **Step 3: Verify the project compiles**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No new errors. Fix any type issues with the SDK message types (they may require more specific type guards).

**Note:** Do NOT commit yet — the old tests import `parseClaudeLine` which no longer exists. Commit adapter + tests together in the next step.

---

### Task 4: Rewrite Claude Adapter Tests (commit together with Task 3)

**Files:**
- Modify: `apps/backend/src/chats/runtime/claude-chat-runtime-adapter.test.ts` (full rewrite)

- [ ] **Step 1: Write tests against the SDK-based adapter**

```ts
// claude-chat-runtime-adapter.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { ClaudeChatRuntimeAdapter } from "./claude-chat-runtime-adapter.js"
import type { ChatRuntimeEvent, ChatRuntimeTurnRequest } from "./types.js"

// Helper: create a fake SDK message stream
function createFakeSdkStream(messages: any[]) {
  let index = 0
  return {
    [Symbol.asyncIterator]() { return this },
    async next() {
      if (index >= messages.length) return { done: true, value: undefined }
      return { done: false, value: messages[index++] }
    },
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    setMaxThinkingTokens: vi.fn(async () => {}),
    close: vi.fn(),
  }
}

function makeRequest(overrides?: Partial<ChatRuntimeTurnRequest>): ChatRuntimeTurnRequest {
  return {
    chatId: "chat_1" as any,
    chatSessionId: "sess_1",
    cwd: "/tmp",
    prompt: "Hello",
    config: {
      provider: "claude",
      model: "claude-sonnet-4-6",
      thinkingLevel: "normal",
      permissionLevel: "full_access",
    },
    continuationPrompt: null,
    seedMessages: [],
    vendorSessionId: null,
    ...overrides,
  }
}

describe("ClaudeChatRuntimeAdapter (SDK)", () => {
  it("streams text_delta events via onEvent", async () => {
    const events: ChatRuntimeEvent[] = []
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
      { type: "result", session_id: "sdk_sess_1", message: { content: [{ type: "text", text: "Hello world" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const deltas = events.filter((e) => e.type === "assistant_delta")
    expect(deltas).toHaveLength(2)
    expect(deltas[0]).toEqual({ type: "assistant_delta", text: "Hello" })
    expect(deltas[1]).toEqual({ type: "assistant_delta", text: " world" })
    expect(result.finalText).toBe("Hello world")
    expect(result.vendorSessionId).toBe("sdk_sess_1")
  })

  it("works without onEvent (batch path)", async () => {
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
      { type: "result", message: { content: [{ type: "text", text: "Hi" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn(makeRequest())
    expect(result.finalText).toBe("Hi")
    expect(result.events.some((e) => e.type === "assistant_delta")).toBe(true)
  })

  it("maps tool_use blocks to tool_activity events", async () => {
    const events: ChatRuntimeEvent[] = []
    const sdkMessages = [
      { type: "content_block_start", content_block: { type: "tool_use", name: "bash", id: "tool_1" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Done" } },
      { type: "result", message: { content: [{ type: "text", text: "Done" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const toolEvents = events.filter((e) => e.type === "tool_activity")
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0]).toEqual({
      type: "tool_activity",
      label: "bash",
      metadata: { id: "tool_1" },
    })
  })

  it("handles SDK errors gracefully", async () => {
    const events: ChatRuntimeEvent[] = []
    const failingStream = {
      [Symbol.asyncIterator]() { return this },
      async next() { throw new Error("SDK connection lost") },
      interrupt: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      setMaxThinkingTokens: vi.fn(async () => {}),
      close: vi.fn(),
    }

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => failingStream as any,
    })

    const result = await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const errorEvents = events.filter((e) => e.type === "runtime_error")
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0]).toEqual({
      type: "runtime_error",
      message: "SDK connection lost",
    })
  })

  it("reuses sessions across turns", async () => {
    // Create a stream that yields different results per turn
    // The iterator stays alive between turns (manual .next() doesn't call return())
    let turnCount = 0
    const messages = [
      // Turn 1 messages
      { type: "content_block_delta", delta: { type: "text_delta", text: "Turn 1" } },
      { type: "result", message: { content: [{ type: "text", text: "Turn 1" }] } },
      // Turn 2 messages
      { type: "content_block_delta", delta: { type: "text_delta", text: "Turn 2" } },
      { type: "result", message: { content: [{ type: "text", text: "Turn 2" }] } },
    ]
    let index = 0
    const longLivedStream = {
      [Symbol.asyncIterator]() { return this },
      async next() {
        if (index >= messages.length) return { done: true, value: undefined }
        return { done: false, value: messages[index++] }
      },
      interrupt: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      setMaxThinkingTokens: vi.fn(async () => {}),
      close: vi.fn(),
    }

    const createQuery = vi.fn(() => longLivedStream as any)
    const adapter = new ClaudeChatRuntimeAdapter({ createQuery })

    const result1 = await adapter.runTurn(makeRequest())
    expect(result1.finalText).toBe("Turn 1")

    const result2 = await adapter.runTurn(makeRequest())
    expect(result2.finalText).toBe("Turn 2")

    // query() should only be called once (session reused, iterator stayed alive)
    expect(createQuery).toHaveBeenCalledOnce()
  })

  it("falls back to joining deltas when no explicit finalText", async () => {
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Joined " } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "text" } },
      { type: "result", message: { content: [] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn(makeRequest())
    expect(result.finalText).toBe("Joined text")
  })

  it("returns diagnostics as undefined", async () => {
    const sdkMessages = [
      { type: "result", message: { content: [{ type: "text", text: "Hi" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    const result = await adapter.runTurn(makeRequest())
    expect(result.diagnostics).toBeUndefined()
  })

  it("maps thinking_delta to runtime_notice", async () => {
    const events: ChatRuntimeEvent[] = []
    const sdkMessages = [
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me think..." } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Answer" } },
      { type: "result", message: { content: [{ type: "text", text: "Answer" }] } },
    ]

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => createFakeSdkStream(sdkMessages),
    })

    await adapter.runTurn({
      ...makeRequest(),
      onEvent: (event) => events.push(event),
    })

    const notices = events.filter((e) => e.type === "runtime_notice")
    expect(notices).toHaveLength(1)
    expect(notices[0]).toEqual({ type: "runtime_notice", message: "Let me think..." })
  })

  it("calls interrupt() on abort signal and returns partial events", async () => {
    const controller = new AbortController()
    const events: ChatRuntimeEvent[] = []

    // Create a stream that blocks after first message until aborted
    let index = 0
    const messages = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Partial" } },
    ]
    const blockingStream = {
      [Symbol.asyncIterator]() { return this },
      async next() {
        if (index < messages.length) {
          return { done: false, value: messages[index++] }
        }
        // Block until abort — simulate long-running turn
        return new Promise(() => {}) // never resolves
      },
      interrupt: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      setMaxThinkingTokens: vi.fn(async () => {}),
      close: vi.fn(),
    }

    const adapter = new ClaudeChatRuntimeAdapter({
      createQuery: () => blockingStream as any,
    })

    // Start the turn and abort after a tick
    const turnPromise = adapter.runTurn({
      ...makeRequest(),
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    })
    // Let the first message be consumed, then abort
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()

    const result = await turnPromise
    expect(blockingStream.interrupt).toHaveBeenCalled()
    expect(events.some((e) => e.type === "assistant_delta")).toBe(true)
  })

  it("destroys session on error and recreates on next turn", async () => {
    const callCount = { value: 0 }
    const createQuery = vi.fn(() => {
      callCount.value++
      if (callCount.value === 1) {
        // First call: stream that throws
        return {
          [Symbol.asyncIterator]() { return this },
          async next() { throw new Error("SDK crash") },
          interrupt: vi.fn(async () => {}),
          setModel: vi.fn(async () => {}),
          setPermissionMode: vi.fn(async () => {}),
          setMaxThinkingTokens: vi.fn(async () => {}),
          close: vi.fn(),
        } as any
      }
      // Second call: working stream
      return createFakeSdkStream([
        { type: "content_block_delta", delta: { type: "text_delta", text: "Recovered" } },
        { type: "result", message: { content: [{ type: "text", text: "Recovered" }] } },
      ])
    })

    const adapter = new ClaudeChatRuntimeAdapter({ createQuery })

    // First turn: error
    const result1 = await adapter.runTurn(makeRequest())
    expect(result1.events.some((e) => e.type === "runtime_error")).toBe(true)

    // Second turn: should create new session (createQuery called again)
    const result2 = await adapter.runTurn(makeRequest())
    expect(result2.finalText).toBe("Recovered")
    expect(createQuery).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd apps/backend && npx vitest run src/chats/runtime/claude-chat-runtime-adapter.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 3: Commit adapter + tests together**

```bash
git add apps/backend/src/chats/runtime/claude-chat-runtime-adapter.ts apps/backend/src/chats/runtime/claude-chat-runtime-adapter.test.ts
git commit -m "feat(ulr-19): rewrite Claude adapter and tests for SDK-based streaming"
```

---

### Task 5: Update Adapter Registration

**Files:**
- Modify: `apps/backend/src/index.ts:187-196`

- [ ] **Step 1: Update the Claude adapter construction**

In `apps/backend/src/index.ts`, change the Claude adapter construction from:

```ts
new ClaudeChatRuntimeAdapter(chatRuntimeProcessRunner),
```

To:

```ts
new ClaudeChatRuntimeAdapter({
  pathToClaudeCodeExecutable: "claude",
}),
```

The `chatRuntimeProcessRunner` is still needed for the Codex adapter (for now), so keep it.

- [ ] **Step 2: Verify the project compiles**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Fix any `diagnostics` optional access issues**

Search the codebase for references to `result.diagnostics` or `.diagnostics.` and add optional chaining where needed (e.g., `result.diagnostics?.exitCode`).

Run: `cd apps/backend && grep -rn "\.diagnostics\." src/ --include="*.ts" | grep -v test | grep -v node_modules`

Fix any that need `?.` instead of `.`.

- [ ] **Step 4: Run full backend tests**

Run: `cd apps/backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(ulr-19): update adapter registration for SDK-based Claude adapter"
```

---

### Task 6: End-to-End Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run full frontend test suite**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS (frontend is unchanged)

- [ ] **Step 3: Start dev server and test streaming**

Run: `pnpm dev`

Create or open a chat configured with Claude provider. Send "Hello world."

Verify:
- Typing indicator (pulsing dots) appears immediately
- Text streams in token-by-token as Claude responds
- When response completes, streaming message is replaced by final persisted message
- Auto-scroll follows streaming text
- Scrolling up pauses auto-scroll
- Turn events show in the debug References panel

- [ ] **Step 4: Test error handling**

- Cancel a turn mid-stream (if UI supports it) — verify accumulated text stays visible
- Test with an invalid model name — verify error event appears

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(ulr-19): Claude SDK adapter end-to-end verification and cleanup"
```
