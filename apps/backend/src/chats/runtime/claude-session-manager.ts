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
            console.log(`[prompt-stream] next() called, pending=${pendingMessages.length}, done=${done}`)
            if (pendingMessages.length > 0) {
              console.log("[prompt-stream] returning queued message immediately")
              return Promise.resolve({ done: false, value: pendingMessages.shift()! })
            }
            if (done) {
              return Promise.resolve({ done: true, value: undefined })
            }
            console.log("[prompt-stream] waiting for message...")
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

    console.log("[claude-session] calling createQuery/query()...", JSON.stringify({
      cwd: queryOptions.cwd,
      model: queryOptions.model,
      permissionMode,
      pathToClaudeCodeExecutable: queryOptions.pathToClaudeCodeExecutable,
      hasResume: !!sessionConfig.vendorSessionId,
      sessionId: vendorSessionId,
    }))
    let queryRuntime: ClaudeQueryRuntime
    try {
      queryRuntime = this.createQueryFn({
        prompt: promptIterable,
        options: queryOptions,
      })
      console.log("[claude-session] query() returned successfully, type:", typeof queryRuntime)
    } catch (err) {
      console.error("[claude-session] query() threw:", err)
      throw err
    }

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
            console.log(`[prompt-stream] push() called, waitingResolve=${!!waitingResolve}`)
            const result = originalPush(...items)
            if (waitingResolve && pendingMessages.length > 0) {
              console.log("[prompt-stream] resolving waiting next()")
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
