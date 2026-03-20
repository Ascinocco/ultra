import {
  unstable_v2_createSession as createSession,
  unstable_v2_resumeSession as resumeSession,
  type SDKSession,
  type SDKSessionOptions,
  type SDKMessage,
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

export type ClaudeSessionContext = {
  chatId: string
  session: SDKSession
  vendorSessionId: string | null
  stopped: boolean
}

export type ClaudeSessionManagerConfig = {
  pathToClaudeCodeExecutable?: string
  defaultEnv?: NodeJS.ProcessEnv
  createSessionFn?: (options: SDKSessionOptions) => SDKSession
  resumeSessionFn?: (sessionId: string, options: SDKSessionOptions) => SDKSession
}

export class ClaudeSessionManager {
  private sessions = new Map<string, ClaudeSessionContext>()
  private config: ClaudeSessionManagerConfig

  constructor(config: ClaudeSessionManagerConfig = {}) {
    this.config = config
  }

  getOrCreate(chatId: string, sessionConfig: ClaudeSessionConfig): ClaudeSessionContext {
    const existing = this.sessions.get(chatId)
    if (existing && !existing.stopped) {
      return existing
    }

    const options: SDKSessionOptions = {
      model: sessionConfig.model,
      pathToClaudeCodeExecutable: this.config.pathToClaudeCodeExecutable ?? "claude",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      canUseTool: this.buildCanUseTool(sessionConfig.permissionLevel),
      env: this.config.defaultEnv ?? process.env,
    }


    let session: SDKSession
    const create = this.config.createSessionFn ?? createSession
    const resume = this.config.resumeSessionFn ?? resumeSession

    if (sessionConfig.vendorSessionId) {
      session = resume(sessionConfig.vendorSessionId, options)
    } else {
      session = create(options)
    }

    const context: ClaudeSessionContext = {
      chatId,
      session,
      vendorSessionId: sessionConfig.vendorSessionId ?? null,
      stopped: false,
    }

    this.sessions.set(chatId, context)
    return context
  }

  destroy(chatId: string): void {
    const context = this.sessions.get(chatId)
    if (context) {
      context.stopped = true
      context.session.close()
      this.sessions.delete(chatId)
    }
  }

  destroyAll(): void {
    for (const [chatId] of this.sessions) {
      this.destroy(chatId)
    }
  }

  private buildCanUseTool(permissionLevel: string): CanUseTool {
    // Always auto-approve for now. ULR-34 will wire supervised approval routing.
    return async () => ({ allowed: true as const })
  }
}
