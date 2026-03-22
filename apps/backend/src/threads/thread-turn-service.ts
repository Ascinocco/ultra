import type { ProjectId, ThreadId } from "@ultra/shared"

import type { ChatRuntimeAdapter, ChatRuntimeEvent } from "../chats/runtime/types.js"
import type { ThreadService } from "./thread-service.js"
import { buildCoordinatorPrompt } from "./coordinator-prompt-builder.js"
import { ChatRuntimeError } from "../chats/runtime/types.js"

// ── Types ────────────────────────────────────────────────────────────

export type ThreadTurnEvent = {
  threadId: ThreadId
  eventType: string
  payload: Record<string, unknown>
}

export type ThreadTurnEventListener = (event: ThreadTurnEvent) => void

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-opus-4-6"

const COORDINATOR_CONFIG = {
  provider: "claude" as const,
  model: DEFAULT_MODEL,
  thinkingLevel: "high" as const,
  permissionLevel: "full_access" as const,
}

// ── Service ──────────────────────────────────────────────────────────

export class ThreadTurnService {
  private readonly activeThreads = new Set<ThreadId>()
  private readonly abortControllers = new Map<ThreadId, AbortController>()

  private readonly listenersByThreadId = new Map<
    ThreadId,
    Set<ThreadTurnEventListener>
  >()

  constructor(
    private readonly threadService: ThreadService,
    private readonly runtimeAdapter: ChatRuntimeAdapter,
  ) {}

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Launch the coordinator session for a thread. Fire-and-forget —
   * callers should not await this in the request path.
   */
  async startCoordinator(threadId: ThreadId): Promise<void> {
    if (this.activeThreads.has(threadId)) {
      return
    }

    const detail = this.threadService.getThread(threadId)
    const thread = detail.thread

    const seedContextJson = this.threadService.getSeedContext(threadId)

    if (!seedContextJson) {
      this.updateThreadState(
        threadId,
        thread.projectId,
        "failed",
        "No seed context available for thread.",
      )
      return
    }

    this.activeThreads.add(threadId)
    const abortController = new AbortController()
    this.abortControllers.set(threadId, abortController)
    this.updateThreadState(threadId, thread.projectId, "running", null)

    try {
      const { textPrompt, attachments } =
        buildCoordinatorPrompt(seedContextJson, thread.projectId)

      const result = await this.runtimeAdapter.runTurn({
        chatId: thread.sourceChatId,
        chatSessionId: `thread_${threadId}`,
        cwd: process.env.ULTRA_REPO_ROOT ?? process.cwd(),
        prompt: textPrompt,
        config: COORDINATOR_CONFIG,
        sessionType: "thread",
        continuationPrompt: null,
        seedMessages: [],
        vendorSessionId: null,
        attachments,
        abortController,
        onEvent: (event) => this.handleCoordinatorEvent(threadId, thread.projectId, event),
      })

      if (result.vendorSessionId) {
        this.threadService.updateVendorSessionId(
          threadId,
          result.vendorSessionId,
        )
      }

      this.persistCoordinatorMessage(threadId, thread.projectId, result.finalText)

      this.updateThreadState(
        threadId,
        thread.projectId,
        "awaiting_review",
        null,
      )
    } catch (error) {
      if (abortController.signal.aborted) {
        this.updateThreadState(threadId, thread.projectId, "blocked", "Canceled by user")
      } else {
        const reason =
          error instanceof Error ? error.message : String(error)
        this.updateThreadState(threadId, thread.projectId, "failed", reason)
      }
    } finally {
      this.activeThreads.delete(threadId)
      this.abortControllers.delete(threadId)
    }
  }

  /**
   * Send a follow-up message to an existing coordinator session.
   * Resumes the vendor session if available, falling back to a fresh
   * session with seed context + the user message on resume failure.
   */
  async sendMessage(threadId: ThreadId, content: string): Promise<void> {
    if (this.activeThreads.has(threadId)) {
      throw new Error("Coordinator is currently running")
    }

    const detail = this.threadService.getThread(threadId)
    const thread = detail.thread

    this.activeThreads.add(threadId)
    const abortController = new AbortController()
    this.abortControllers.set(threadId, abortController)
    this.updateThreadState(threadId, thread.projectId, "running", null)

    try {
      const vendorSessionId = this.getVendorSessionId(threadId)

      try {
        const result = await this.runtimeAdapter.runTurn({
          chatId: thread.sourceChatId,
          chatSessionId: `thread_${threadId}`,
          cwd: process.env.ULTRA_REPO_ROOT ?? process.cwd(),
          prompt: content,
          config: COORDINATOR_CONFIG,
          sessionType: "thread",
          continuationPrompt: null,
          seedMessages: [],
          vendorSessionId: vendorSessionId,
          abortController,
          onEvent: (event) => this.handleCoordinatorEvent(threadId, thread.projectId, event),
        })

        if (result.vendorSessionId) {
          this.threadService.updateVendorSessionId(
            threadId,
            result.vendorSessionId,
          )
        }

        this.persistCoordinatorMessage(threadId, thread.projectId, result.finalText)

        this.updateThreadState(
          threadId,
          thread.projectId,
          "awaiting_review",
          null,
        )
      } catch (error) {
        if (!this.isResumeError(error)) {
          throw error
        }

        // Resume failed — retry fresh with seed context + user message
        const seedContextJson = this.threadService.getSeedContext(threadId)

        if (!seedContextJson) {
          throw new Error(
            "Resume failed and no seed context available for fresh retry.",
          )
        }

        const { textPrompt, attachments } =
          buildCoordinatorPrompt(seedContextJson, thread.projectId)
        const freshPrompt = `${textPrompt}\n\n## Follow-up Message\n\n${content}`

        const result = await this.runtimeAdapter.runTurn({
          chatId: thread.sourceChatId,
          chatSessionId: `thread_${threadId}`,
          cwd: process.env.ULTRA_REPO_ROOT ?? process.cwd(),
          prompt: freshPrompt,
          config: COORDINATOR_CONFIG,
          sessionType: "thread",
          continuationPrompt: null,
          seedMessages: [],
          vendorSessionId: null,
          attachments,
          abortController,
          onEvent: (event) => this.handleCoordinatorEvent(threadId, thread.projectId, event),
        })

        if (result.vendorSessionId) {
          this.threadService.updateVendorSessionId(
            threadId,
            result.vendorSessionId,
          )
        }

        this.persistCoordinatorMessage(threadId, thread.projectId, result.finalText)

        this.updateThreadState(
          threadId,
          thread.projectId,
          "awaiting_review",
          null,
        )
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        this.updateThreadState(threadId, thread.projectId, "blocked", "Canceled by user")
      } else {
        const reason =
          error instanceof Error ? error.message : String(error)
        this.updateThreadState(threadId, thread.projectId, "failed", reason)
      }
    } finally {
      this.activeThreads.delete(threadId)
      this.abortControllers.delete(threadId)
    }
  }

  /**
   * Cancel a running coordinator session.
   */
  cancelCoordinator(threadId: ThreadId): void {
    const controller = this.abortControllers.get(threadId)
    if (controller) {
      controller.abort()
    }
  }

  /**
   * Check whether a coordinator session is currently running for the thread.
   */
  isActive(threadId: ThreadId): boolean {
    return this.activeThreads.has(threadId)
  }

  /**
   * Subscribe to coordinator events for a thread. Returns an unsubscribe function.
   */
  addEventListener(
    threadId: ThreadId,
    listener: ThreadTurnEventListener,
  ): () => void {
    const listeners = this.listenersByThreadId.get(threadId) ?? new Set()
    listeners.add(listener)
    this.listenersByThreadId.set(threadId, listeners)

    return () => {
      const active = this.listenersByThreadId.get(threadId)

      if (!active) {
        return
      }

      active.delete(listener)
      if (active.size === 0) {
        this.listenersByThreadId.delete(threadId)
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private handleCoordinatorEvent(
    threadId: ThreadId,
    projectId: ProjectId,
    event: ChatRuntimeEvent,
  ): void {
    const threadEvent: ThreadTurnEvent = {
      threadId,
      eventType: event.type,
      payload: "text" in event
        ? { text: event.text }
        : "message" in event
          ? { message: event.message }
          : "label" in event
            ? { label: event.label, metadata: event.metadata }
            : "checkpoint" in event
              ? { checkpoint: event.checkpoint }
              : {},
    }

    // Detect AskUserQuestion → transition to "blocked" (waiting for user input)
    if (event.type === "tool_activity" && "label" in event && event.label === "AskUserQuestion") {
      this.threadService.updateExecutionState(threadId, "blocked", null)
    }

    // Persist all events for history reconstruction on revisit
    try {
      this.threadService.appendProjectedEvent({
        actorType: "coordinator",
        eventType: `coordinator.${event.type}`,
        payload: threadEvent.payload,
        projectId,
        source: "ultra.coordinator",
        threadId,
      })
    } catch {
      // Persistence failure must not disrupt the coordinator session.
    }

    const listeners = this.listenersByThreadId.get(threadId)

    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      try {
        listener(threadEvent)
      } catch {
        // Listener errors must not disrupt the coordinator session.
      }
    }
  }

  private persistCoordinatorMessage(
    threadId: ThreadId,
    projectId: ProjectId,
    finalText: string,
  ): void {
    if (!finalText) return

    try {
      this.threadService.appendMessage({
        threadId,
        projectId,
        role: "coordinator",
        messageType: "text",
        contentText: finalText,
        provider: COORDINATOR_CONFIG.provider,
        model: COORDINATOR_CONFIG.model,
      })
    } catch {
      // Message persistence failure must not break the coordinator flow.
    }
  }

  private updateThreadState(
    threadId: ThreadId,
    _projectId: ProjectId,
    executionState: string,
    failureReason: string | null,
  ): void {
    this.threadService.updateExecutionState(
      threadId,
      executionState,
      failureReason,
    )
  }

  private getVendorSessionId(threadId: ThreadId): string | null {
    return this.threadService.getVendorSessionId(threadId)
  }

  private isResumeError(error: unknown): boolean {
    if (error instanceof ChatRuntimeError) {
      return error.kind === "resume_failed"
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      return (
        message.includes("resume") ||
        message.includes("session not found") ||
        message.includes("session expired")
      )
    }

    return false
  }
}
