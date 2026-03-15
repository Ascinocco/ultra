import type { ChatId } from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import type {
  ChatMessageSnapshot,
  ChatRuntimeConfig,
  ChatService,
} from "./chat-service.js"
import type { ChatRuntimeRegistry } from "./runtime/chat-runtime-registry.js"
import { buildContinuationPromptFromMessages } from "./runtime/runtime-helpers.js"
import type { ChatRuntimeSessionManager } from "./runtime/runtime-session-manager.js"
import type {
  ChatRuntimeCheckpointCandidate,
  ChatRuntimeError,
} from "./runtime/types.js"

export type ChatTurnResult = {
  userMessage: ChatMessageSnapshot
  assistantMessage: ChatMessageSnapshot
  checkpointIds: string[]
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value)
}

export class ChatTurnService {
  constructor(
    private readonly chatService: ChatService,
    private readonly runtimeRegistry: ChatRuntimeRegistry,
    private readonly sessionManager: ChatRuntimeSessionManager,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async sendMessage(chatId: ChatId, prompt: string): Promise<ChatTurnResult> {
    const normalizedPrompt = prompt.trim()

    if (normalizedPrompt.length === 0) {
      throw new IpcProtocolError(
        "invalid_request",
        "Chat prompt must not be empty.",
      )
    }

    const userMessage = this.chatService.appendMessage({
      chatId,
      role: "user",
      messageType: "user_text",
      contentMarkdown: normalizedPrompt,
    })

    const initialContext = this.chatService.getRuntimeContext(chatId)
    const session = this.sessionManager.getSession(
      chatId,
      initialContext.chatSessionId,
      this.extractConfig(initialContext.chat),
      initialContext.rootPath,
    )
    const seedMessages = this.chatService.listMessages(chatId)

    try {
      const result = await this.runTurnWithRecovery(
        initialContext.chat,
        initialContext.rootPath,
        initialContext.chatSessionId,
        normalizedPrompt,
        initialContext.continuationPrompt,
        seedMessages,
        session?.vendorSessionId ?? null,
      )

      const assistantMessage = this.chatService.appendMessage({
        chatId,
        role: "assistant",
        messageType: "assistant_text",
        contentMarkdown: result.finalText,
        providerMessageId: result.vendorSessionId,
      })
      this.sessionManager.saveSession({
        chatId,
        chatSessionId: initialContext.chatSessionId,
        provider: initialContext.chat.provider,
        model: initialContext.chat.model,
        thinkingLevel: initialContext.chat.thinkingLevel,
        permissionLevel: initialContext.chat.permissionLevel,
        cwd: initialContext.rootPath,
        vendorSessionId: result.vendorSessionId,
        lastActivityAt: this.now(),
      })
      const checkpointIds = this.persistCheckpointCandidates(
        chatId,
        result.events
          .filter((event) => event.type === "checkpoint_candidate")
          .map((event) => event.checkpoint),
      )
      const continuationPrompt = buildContinuationPromptFromMessages(
        this.chatService.listMessages(chatId),
      )

      this.chatService.updateSessionContinuationPrompt(
        initialContext.chatSessionId,
        continuationPrompt,
      )
      this.chatService.touch(chatId, this.now())

      return {
        userMessage,
        assistantMessage,
        checkpointIds,
      }
    } catch (error) {
      if (this.isRuntimeError(error)) {
        throw this.mapRuntimeError(error)
      }

      throw error
    }
  }

  private async runTurnWithRecovery(
    chat: ReturnType<ChatService["get"]>,
    rootPath: string,
    chatSessionId: string,
    prompt: string,
    continuationPrompt: string | null,
    seedMessages: ChatMessageSnapshot[],
    vendorSessionId: string | null,
  ) {
    const adapter = this.runtimeRegistry.get(chat.provider)

    try {
      return await adapter.runTurn({
        chatId: chat.id,
        chatSessionId,
        cwd: rootPath,
        prompt,
        config: this.extractConfig(chat),
        continuationPrompt,
        seedMessages,
        vendorSessionId,
      })
    } catch (error) {
      if (!this.isRuntimeError(error) || error.kind !== "resume_failed") {
        throw error
      }

      this.sessionManager.invalidate(chat.id, chatSessionId)

      return adapter.runTurn({
        chatId: chat.id,
        chatSessionId,
        cwd: rootPath,
        prompt,
        config: this.extractConfig(chat),
        continuationPrompt,
        seedMessages,
        vendorSessionId: null,
      })
    }
  }

  private persistCheckpointCandidates(
    chatId: ChatId,
    checkpoints: ChatRuntimeCheckpointCandidate[],
  ): string[] {
    return checkpoints.map((checkpoint) =>
      this.chatService.createActionCheckpoint({
        chatId,
        activeTargetPath: checkpoint.activeTargetPath ?? null,
        branchName: checkpoint.branchName ?? null,
        worktreePath: checkpoint.worktreePath ?? null,
        actionType: checkpoint.actionType,
        affectedPaths: checkpoint.affectedPaths,
        commandMetadataJson: checkpoint.commandMetadata
          ? serializeJson(checkpoint.commandMetadata)
          : null,
        resultSummary: checkpoint.resultSummary ?? null,
        artifactRefsJson: checkpoint.artifactRefs
          ? serializeJson(checkpoint.artifactRefs)
          : null,
      }),
    )
  }

  private extractConfig(
    chat: ReturnType<ChatService["get"]>,
  ): ChatRuntimeConfig {
    return {
      provider: chat.provider,
      model: chat.model,
      thinkingLevel: chat.thinkingLevel,
      permissionLevel: chat.permissionLevel,
    }
  }

  private isRuntimeError(error: unknown): error is ChatRuntimeError {
    return (
      error instanceof Error &&
      "kind" in error &&
      typeof (error as { kind?: unknown }).kind === "string"
    )
  }

  private mapRuntimeError(error: ChatRuntimeError): IpcProtocolError {
    switch (error.kind) {
      case "invalid_config":
        return new IpcProtocolError("invalid_request", error.message, {
          details: error.diagnostics,
        })
      case "resume_failed":
      case "launch_failed":
      case "unexpected_exit":
      case "empty_response":
      case "protocol_error":
        return new IpcProtocolError("runtime_unavailable", error.message, {
          details: error.diagnostics,
        })
      default:
        return new IpcProtocolError("internal_error", error.message, {
          details: error.diagnostics,
        })
    }
  }
}
