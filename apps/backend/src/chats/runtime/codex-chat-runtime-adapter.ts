import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"

import { JsonRpcClient } from "./json-rpc-client.js"
import { buildSeededPrompt } from "./runtime-helpers.js"
import type {
  ChatRuntimeAdapter,
  ChatRuntimeEvent,
  ChatRuntimeTurnRequest,
  ChatRuntimeTurnResult,
} from "./types.js"
import { ChatRuntimeError } from "./types.js"
import type { ChatRuntimeConfig } from "../chat-service.js"

// ---------------------------------------------------------------------------
// Config & session types
// ---------------------------------------------------------------------------

export type CodexAdapterConfig = {
  codexBinaryPath?: string
  codexHomePath?: string
  defaultEnv?: NodeJS.ProcessEnv
  spawnFn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
}

type CodexSession = {
  child: ChildProcess
  rpcClient: JsonRpcClient
  providerThreadId: string | null
  activeTurnResolve: ((value: void) => void) | null
  stopped: boolean
  accumulatedText: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCodexSandbox(
  permissionLevel: ChatRuntimeConfig["permissionLevel"],
): string {
  return permissionLevel === "full_access"
    ? "danger-full-access"
    : "workspace-write"
}

function resolveCodexApprovalPolicy(
  permissionLevel: ChatRuntimeConfig["permissionLevel"],
): string {
  return permissionLevel === "full_access" ? "never" : "on-request"
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CodexChatRuntimeAdapter implements ChatRuntimeAdapter {
  readonly provider = "codex" as const

  private config: CodexAdapterConfig
  private sessions = new Map<string, CodexSession>()

  constructor(config: CodexAdapterConfig = {}) {
    this.config = config
  }

  async runTurn(
    request: ChatRuntimeTurnRequest,
  ): Promise<ChatRuntimeTurnResult> {
    const sessionKey = request.chatSessionId

    let session = this.sessions.get(sessionKey)
    if (session?.stopped) {
      this.destroySession(sessionKey)
      session = undefined
    }

    const isResume = !!session
    if (!session) {
      session = await this.createSession(request)
      this.sessions.set(sessionKey, session)
    }

    // Build turn input
    const promptText = buildSeededPrompt(request)
    const turnInput = [{ type: "text" as const, text: promptText, text_elements: [] as never[] }]

    // Prepare to collect events
    const collectedEvents: ChatRuntimeEvent[] = []
    session.accumulatedText = ""

    const emitEvent = (event: ChatRuntimeEvent) => {
      collectedEvents.push(event)
      request.onEvent?.(event)
      if (event.type === "assistant_delta") {
        session!.accumulatedText += event.text
      }
    }

    // Wire up notification handler for this turn
    const turnComplete = new Promise<void>((resolve) => {
      session!.activeTurnResolve = resolve
    })

    session.rpcClient.onNotification((method, params) => {
      this.handleNotification(session!, method, params as Record<string, unknown>, emitEvent)
    })

    // Auto-approve all approval requests
    session.rpcClient.onRequest((id, _method, _params) => {
      session!.rpcClient.respond(id, { decision: "approved" })
    })

    // Determine whether to start or resume the thread turn
    const threadId = session.providerThreadId
    const turnStartParams: Record<string, unknown> = {
      threadId,
      input: turnInput,
      model: request.config.model,
    }

    try {
      const response = await session.rpcClient.request<{ turn?: { id?: string } }>(
        "turn/start",
        turnStartParams,
      )
      const _turnId = response?.turn?.id
    } catch (error) {
      this.destroySession(sessionKey)
      throw new ChatRuntimeError(
        isResume ? "resume_failed" : "launch_failed",
        error instanceof Error ? error.message : "turn/start failed",
      )
    }

    // Wait for turn/completed notification
    await turnComplete

    const finalText = session.accumulatedText.trim()
    session.activeTurnResolve = null

    if (finalText.length === 0) {
      throw new ChatRuntimeError(
        "empty_response",
        "Codex returned no assistant text.",
      )
    }

    const finalEvent: ChatRuntimeEvent = { type: "assistant_final", text: finalText }
    collectedEvents.push(finalEvent)
    request.onEvent?.(finalEvent)

    return {
      events: collectedEvents,
      finalText,
      vendorSessionId: session.providerThreadId,
      resumed: isResume,
    }
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  private async createSession(
    request: ChatRuntimeTurnRequest,
  ): Promise<CodexSession> {
    const binaryPath = this.config.codexBinaryPath ?? "codex"
    const spawnFn = this.config.spawnFn ?? spawn

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(this.config.defaultEnv ?? {}),
      ...(this.config.codexHomePath ? { CODEX_HOME: this.config.codexHomePath } : {}),
    }

    const child = spawnFn(binaryPath, ["app-server"], {
      cwd: request.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const session: CodexSession = {
      child,
      rpcClient: new JsonRpcClient(child.stdin!, child.stdout!),
      providerThreadId: null,
      activeTurnResolve: null,
      stopped: false,
      accumulatedText: "",
    }

    // Crash detection
    child.on("exit", () => {
      session.stopped = true
      // If a turn is active, resolve it so the awaiting promise unblocks
      session.activeTurnResolve?.()
    })

    // Initialize handshake
    try {
      await session.rpcClient.request("initialize", {
        clientInfo: { name: "ultra", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      })
      session.rpcClient.notify("initialized")
    } catch (error) {
      this.killChild(session)
      throw new ChatRuntimeError(
        "launch_failed",
        error instanceof Error ? error.message : "Initialize handshake failed",
      )
    }

    // Open thread — capture providerThreadId from thread/started notification
    const threadIdPromise = new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 15_000)

      session.rpcClient.onNotification((method, params) => {
        if (method === "thread/started") {
          clearTimeout(timeout)
          const p = params as { thread?: { id?: string } }
          resolve(p?.thread?.id ?? null)
        }
      })
    })

    const sandbox = resolveCodexSandbox(request.config.permissionLevel)
    const approvalPolicy = resolveCodexApprovalPolicy(request.config.permissionLevel)

    const threadMethod = request.vendorSessionId ? "thread/resume" : "thread/start"
    const threadParams: Record<string, unknown> = {
      model: request.config.model,
      approvalPolicy,
      sandbox,
      experimentalRawEvents: false,
      cwd: request.cwd,
    }
    if (request.vendorSessionId) {
      threadParams.threadId = request.vendorSessionId
    }

    try {
      await session.rpcClient.request(threadMethod, threadParams)
    } catch (error) {
      // If resume fails, fall back to thread/start
      if (threadMethod === "thread/resume") {
        try {
          const { threadId: _removed, ...startParams } = threadParams
          await session.rpcClient.request("thread/start", startParams)
        } catch (startError) {
          this.killChild(session)
          throw new ChatRuntimeError(
            "launch_failed",
            startError instanceof Error ? startError.message : "thread/start failed",
          )
        }
      } else {
        this.killChild(session)
        throw new ChatRuntimeError(
          "launch_failed",
          error instanceof Error ? error.message : "thread/start failed",
        )
      }
    }

    const providerThreadId = await threadIdPromise
    session.providerThreadId = providerThreadId

    return session
  }

  private handleNotification(
    session: CodexSession,
    method: string,
    params: Record<string, unknown>,
    emitEvent: (event: ChatRuntimeEvent) => void,
  ): void {
    switch (method) {
      case "item/agentMessage/delta": {
        const delta = typeof params.delta === "string" ? params.delta : ""
        if (delta) {
          emitEvent({ type: "assistant_delta", text: delta })
        }
        break
      }
      case "item/started": {
        const item = params.item as Record<string, unknown> | undefined
        const label = typeof item?.type === "string" ? item.type : "activity"
        emitEvent({ type: "tool_activity", label, metadata: params })
        break
      }
      case "item/completed": {
        const item = params.item as Record<string, unknown> | undefined
        const label = typeof item?.type === "string" ? item.type : "activity"
        emitEvent({ type: "tool_activity", label, metadata: params })
        break
      }
      case "item/commandExecution/outputDelta": {
        emitEvent({ type: "tool_activity", label: "command_output" })
        break
      }
      case "thread/started": {
        // Capture provider thread ID for session reuse
        const thread = params.thread as { id?: string } | undefined
        if (thread?.id) {
          session.providerThreadId = thread.id
        }
        break
      }
      case "turn/completed": {
        // Signal turn end
        session.activeTurnResolve?.()
        break
      }
      case "error": {
        const errorObj = params.error as { message?: string } | undefined
        const message = typeof errorObj?.message === "string" ? errorObj.message : "Codex error"
        emitEvent({ type: "runtime_error", message })
        break
      }
    }
  }

  private destroySession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey)
    if (!session) return
    this.sessions.delete(sessionKey)
    this.killChild(session)
  }

  private killChild(session: CodexSession): void {
    session.stopped = true
    session.rpcClient.destroy()
    try {
      session.child.kill("SIGTERM")
    } catch {
      // Process may already be dead
    }
  }

  shutdown(): void {
    for (const [key] of this.sessions) {
      this.destroySession(key)
    }
  }
}
