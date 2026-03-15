import type { ChatId } from "@ultra/shared"
import type { ChatRuntimeConfig } from "../chat-service.js"
import type { ChatRuntimeSession } from "./types.js"

function buildFingerprint(config: ChatRuntimeConfig, cwd: string): string {
  return [
    config.provider,
    config.model,
    config.thinkingLevel,
    config.permissionLevel,
    cwd,
  ].join("|")
}

function buildKey(chatId: ChatId, chatSessionId: string): string {
  return `${chatId}:${chatSessionId}`
}

export class ChatRuntimeSessionManager {
  private readonly sessions = new Map<string, ChatRuntimeSession>()

  getSession(
    chatId: ChatId,
    chatSessionId: string,
    config: ChatRuntimeConfig,
    cwd: string,
  ): ChatRuntimeSession | null {
    const key = buildKey(chatId, chatSessionId)
    const session = this.sessions.get(key)

    if (!session) {
      return null
    }

    if (session.configFingerprint !== buildFingerprint(config, cwd)) {
      this.sessions.delete(key)
      return null
    }

    return { ...session }
  }

  saveSession(
    session: Omit<ChatRuntimeSession, "configFingerprint">,
  ): ChatRuntimeSession {
    const nextSession: ChatRuntimeSession = {
      ...session,
      configFingerprint: buildFingerprint(
        {
          provider: session.provider,
          model: session.model,
          thinkingLevel: session.thinkingLevel,
          permissionLevel: session.permissionLevel,
        },
        session.cwd,
      ),
    }

    this.sessions.set(
      buildKey(session.chatId, session.chatSessionId),
      nextSession,
    )
    return { ...nextSession }
  }

  invalidate(chatId: ChatId, chatSessionId: string): void {
    this.sessions.delete(buildKey(chatId, chatSessionId))
  }

  disposeChat(chatId: ChatId): void {
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${chatId}:`)) {
        this.sessions.delete(key)
      }
    }
  }

  size(): number {
    return this.sessions.size
  }
}
