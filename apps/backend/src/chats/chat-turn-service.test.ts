import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { IpcProtocolError } from "../ipc/errors.js"
import { ProjectService } from "../projects/project-service.js"
import { ChatService } from "./chat-service.js"
import { ChatTurnService } from "./chat-turn-service.js"
import { ChatRuntimeRegistry } from "./runtime/chat-runtime-registry.js"
import { ChatRuntimeSessionManager } from "./runtime/runtime-session-manager.js"
import { type ChatRuntimeAdapter, ChatRuntimeError } from "./runtime/types.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  directory: string
  databasePath: string
  projectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-chat-turn-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    directory,
    databasePath: join(directory, "ultra.db"),
    projectPath,
  }
}

function createAdapter(
  provider: "codex" | "claude",
  implementation: ChatRuntimeAdapter["runTurn"],
): ChatRuntimeAdapter {
  return {
    provider,
    runTurn: implementation,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForTurnStatus(
  service: ChatTurnService,
  chatId: string,
  turnId: string,
  statuses: string[],
  timeoutMs = 2_000,
): Promise<ReturnType<ChatTurnService["getTurn"]>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const turn = service.getTurn(chatId, turnId)
    if (statuses.includes(turn.status)) {
      return turn
    }
    await sleep(10)
  }

  throw new Error(
    `Timed out waiting for turn ${turnId} in chat ${chatId} to reach one of: ${statuses.join(", ")}`,
  )
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("ChatTurnService", () => {
  it("runs queued turns asynchronously and preserves idempotent client turn ids", async () => {
    const { databasePath, projectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-18T12:00:${String(tick).padStart(2, "0")}Z`
    }
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const service = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        createAdapter("codex", async (request) => {
          return {
            events: [
              {
                type: "assistant_final",
                text: `Ack: ${request.prompt}`,
              },
            ],
            finalText: `Ack: ${request.prompt}`,
            vendorSessionId: "vendor_codex_async_1",
            diagnostics: {
              exitCode: 0,
              signal: null,
              stdout: "",
              stderr: "",
              stdoutLines: [],
              stderrLines: [],
              timedOut: false,
            },
            resumed: request.vendorSessionId !== null,
          }
        }),
      ]),
      new ChatRuntimeSessionManager(),
      now,
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const eventTypes: string[] = []

    const unsubscribe = service.subscribeToTurnEvents({ chatId: chat.id }, (event) => {
      eventTypes.push(event.eventType)
    })

    const first = service.startTurn({
      chatId: chat.id,
      prompt: "Plan implementation steps",
      clientTurnId: "client_turn_1",
    })
    const second = service.startTurn({
      chatId: chat.id,
      prompt: "This should be idempotent",
      clientTurnId: "client_turn_1",
    })

    const completed = await waitForTurnStatus(service, chat.id, first.turn.turnId, [
      "succeeded",
    ])
    const loaded = service.getTurn(chat.id, first.turn.turnId)
    const listed = service.listTurns({ chatId: chat.id, limit: 20 })
    const events = service.getTurnEvents(chat.id, first.turn.turnId)
    const turnCount = runtime.database
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM chat_turns WHERE chat_id = ?",
      )
      .get(chat.id)?.count
    const messageCount = runtime.database
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE chat_id = ?",
      )
      .get(chat.id)?.count

    unsubscribe()

    expect(first.accepted).toBe(true)
    expect(second.turn.turnId).toBe(first.turn.turnId)
    expect(loaded.turnId).toBe(first.turn.turnId)
    expect(completed.status).toBe("succeeded")
    expect(turnCount).toBe(1)
    expect(messageCount).toBe(2)
    expect(listed.turns.map((turn) => turn.turnId)).toEqual([first.turn.turnId])
    expect(listed.nextCursor).toBeNull()
    expect(events.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "chat.turn_queued",
        "chat.turn_started",
        "chat.turn_progress",
        "chat.turn_completed",
      ]),
    )
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "chat.turn_queued",
        "chat.turn_started",
        "chat.turn_progress",
        "chat.turn_completed",
      ]),
    )

    runtime.close()
  })

  it("enforces one active turn per chat", async () => {
    const { databasePath, projectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-18T13:00:${String(tick).padStart(2, "0")}Z`
    }
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    let releaseRuntime: (() => void) | null = null
    const runtimeBlocked = new Promise<void>((resolve) => {
      releaseRuntime = resolve
    })
    const service = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        createAdapter("codex", async (request) => {
          await runtimeBlocked
          return {
            events: [{ type: "assistant_final", text: `Ack: ${request.prompt}` }],
            finalText: `Ack: ${request.prompt}`,
            vendorSessionId: "vendor_codex_guard_1",
            diagnostics: {
              exitCode: 0,
              signal: null,
              stdout: "",
              stderr: "",
              stdoutLines: [],
              stderrLines: [],
              timedOut: false,
            },
            resumed: false,
          }
        }),
      ]),
      new ChatRuntimeSessionManager(),
      now,
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    const started = service.startTurn({
      chatId: chat.id,
      prompt: "Start first turn",
    })

    let conflict: unknown
    try {
      service.startTurn({
        chatId: chat.id,
        prompt: "Start conflicting turn",
      })
    } catch (error) {
      conflict = error
    }

    expect(conflict).toBeInstanceOf(IpcProtocolError)
    if (conflict instanceof IpcProtocolError) {
      expect(conflict.code).toBe("conflict")
    }

    service.cancelTurn(chat.id, started.turn.turnId)
    releaseRuntime?.()
    await waitForTurnStatus(service, chat.id, started.turn.turnId, ["canceled"])

    runtime.close()
  })

  it("cancels running turns and publishes terminal canceled events", async () => {
    const { databasePath, projectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-18T13:30:${String(tick).padStart(2, "0")}Z`
    }
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    let releaseRuntime: (() => void) | null = null
    const runtimeBlocked = new Promise<void>((resolve) => {
      releaseRuntime = resolve
    })
    const service = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        createAdapter("codex", async (request) => {
          await runtimeBlocked
          return {
            events: [{ type: "assistant_final", text: `Ack: ${request.prompt}` }],
            finalText: `Ack: ${request.prompt}`,
            vendorSessionId: "vendor_codex_cancel_1",
            diagnostics: {
              exitCode: 0,
              signal: null,
              stdout: "",
              stderr: "",
              stdoutLines: [],
              stderrLines: [],
              timedOut: false,
            },
            resumed: false,
          }
        }),
      ]),
      new ChatRuntimeSessionManager(),
      now,
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)
    const eventTypes: string[] = []

    const unsubscribe = service.subscribeToTurnEvents({ chatId: chat.id }, (event) => {
      eventTypes.push(event.eventType)
    })
    const started = service.startTurn({
      chatId: chat.id,
      prompt: "Run and then cancel",
    })

    await waitForTurnStatus(service, chat.id, started.turn.turnId, ["running"])
    const cancelRequested = service.cancelTurn(chat.id, started.turn.turnId)
    expect(cancelRequested.status).toBe("running")
    expect(cancelRequested.cancelRequestedAt).not.toBeNull()

    releaseRuntime?.()
    const canceled = await waitForTurnStatus(service, chat.id, started.turn.turnId, [
      "canceled",
    ])
    const events = service.getTurnEvents(chat.id, started.turn.turnId)

    unsubscribe()

    expect(canceled.status).toBe("canceled")
    expect(events.events.at(-1)?.eventType).toBe("chat.turn_canceled")
    expect(events.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "chat.turn_queued",
        "chat.turn_started",
        "chat.turn_progress",
        "chat.turn_canceled",
      ]),
    )
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "chat.turn_queued",
        "chat.turn_started",
        "chat.turn_progress",
        "chat.turn_canceled",
      ]),
    )

    runtime.close()
  })

  it("marks orchestrated turns as failed when runtime execution errors", async () => {
    const { databasePath, projectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-18T14:00:${String(tick).padStart(2, "0")}Z`
    }
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const service = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        createAdapter("codex", async () => {
          throw new ChatRuntimeError("launch_failed", "runtime unavailable")
        }),
      ]),
      new ChatRuntimeSessionManager(),
      now,
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    const started = service.startTurn({
      chatId: chat.id,
      prompt: "This should fail",
    })
    const failed = await waitForTurnStatus(service, chat.id, started.turn.turnId, [
      "failed",
    ])
    const events = service.getTurnEvents(chat.id, started.turn.turnId)

    expect(failed.status).toBe("failed")
    expect(failed.failureCode).toBe("runtime_unavailable")
    expect(events.events.at(-1)?.eventType).toBe("chat.turn_failed")
    expect(events.events.at(-1)?.payload).toMatchObject({
      code: "runtime_unavailable",
      message: "runtime unavailable",
    })

    runtime.close()
  })

  it("maps missing runtime binaries to actionable runtime-unavailable failures", async () => {
    const { databasePath, projectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-18T14:15:${String(tick).padStart(2, "0")}Z`
    }
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const service = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        createAdapter("codex", async () => {
          const missingBinary = Object.assign(new Error("spawn codex ENOENT"), {
            code: "ENOENT",
            path: "codex",
          })
          throw missingBinary
        }),
      ]),
      new ChatRuntimeSessionManager(),
      now,
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    const started = service.startTurn({
      chatId: chat.id,
      prompt: "Trigger missing codex runtime",
    })
    const failed = await waitForTurnStatus(service, chat.id, started.turn.turnId, [
      "failed",
    ])
    const events = service.getTurnEvents(chat.id, started.turn.turnId)

    expect(failed.status).toBe("failed")
    expect(failed.failureCode).toBe("runtime_unavailable")
    expect(failed.failureMessage).toContain("Install Codex CLI")
    expect(events.events.at(-1)?.payload).toMatchObject({
      code: "runtime_unavailable",
    })
    expect(events.events.at(-1)?.payload.message).toContain("codex")

    runtime.close()
  })

  it("persists user and assistant messages plus checkpoints and reuses the runtime session", async () => {
    const { databasePath, projectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T12:00:${String(tick).padStart(2, "0")}Z`
    }
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const sessionManager = new ChatRuntimeSessionManager()
    const requests: Array<{ vendorSessionId: string | null; prompt: string }> =
      []
    const registry = new ChatRuntimeRegistry([
      createAdapter("codex", async (request) => {
        requests.push({
          vendorSessionId: request.vendorSessionId,
          prompt: request.prompt,
        })

        return {
          events: [
            {
              type: "checkpoint_candidate",
              checkpoint: {
                actionType: "tool_activity",
                affectedPaths: ["src/index.ts"],
                resultSummary: "Checked src/index.ts",
              },
            },
            {
              type: "assistant_final",
              text: `Ack: ${request.prompt}`,
            },
          ],
          finalText: `Ack: ${request.prompt}`,
          vendorSessionId: "vendor_codex_1",
          diagnostics: {
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            stdoutLines: [],
            stderrLines: [],
            timedOut: false,
          },
          resumed: request.vendorSessionId !== null,
        }
      }),
    ])
    const service = new ChatTurnService(
      chatService,
      registry,
      sessionManager,
      now,
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    const first = await service.sendMessage(chat.id, "First task")
    const second = await service.sendMessage(chat.id, "Second task")
    const persistedMessages = chatService.listMessages(chat.id)
    const checkpointCount = runtime.database
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM chat_action_checkpoints WHERE chat_id = ?",
      )
      .get(chat.id)?.count

    expect(first.userMessage.messageType).toBe("user_text")
    expect(first.assistantMessage.contentMarkdown).toBe("Ack: First task")
    expect(second.assistantMessage.contentMarkdown).toBe("Ack: Second task")
    expect(requests).toEqual([
      { vendorSessionId: null, prompt: "First task" },
      { vendorSessionId: "vendor_codex_1", prompt: "Second task" },
    ])
    expect(persistedMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    expect(checkpointCount).toBe(2)
    expect(sessionManager.size()).toBe(1)

    runtime.close()
  })

  it("recovers from resume failure by retrying with a fresh vendor session", async () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(runtime.database)
    const sessionManager = new ChatRuntimeSessionManager()
    let callCount = 0
    const registry = new ChatRuntimeRegistry([
      createAdapter("codex", async (request) => {
        callCount += 1

        if (callCount === 2 && request.vendorSessionId) {
          throw new ChatRuntimeError("resume_failed", "resume failed", {
            exitCode: 1,
            signal: null,
            stdout: "",
            stderr: "resume failed",
            stdoutLines: [],
            stderrLines: ["resume failed"],
            timedOut: false,
          })
        }

        return {
          events: [
            {
              type: "assistant_final",
              text: `Ack: ${request.prompt}`,
            },
          ],
          finalText: `Ack: ${request.prompt}`,
          vendorSessionId: `vendor_codex_${callCount}`,
          diagnostics: {
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            stdoutLines: [],
            stderrLines: [],
            timedOut: false,
          },
          resumed: request.vendorSessionId !== null,
        }
      }),
    ])
    const service = new ChatTurnService(chatService, registry, sessionManager)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    await service.sendMessage(chat.id, "First")
    const second = await service.sendMessage(chat.id, "Second")

    expect(callCount).toBe(3)
    expect(second.assistantMessage.contentMarkdown).toBe("Ack: Second")
    expect(chatService.listSessions(chat.id)[0]?.continuationPrompt).toContain(
      "User: First",
    )

    runtime.close()
  })

  it("supports claude-backed chats and maps invalid runtime config to protocol errors", async () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(runtime.database)
    const sessionManager = new ChatRuntimeSessionManager()
    const registry = new ChatRuntimeRegistry([
      createAdapter("codex", async () => ({
        events: [{ type: "assistant_final", text: "unused" }],
        finalText: "unused",
        vendorSessionId: "vendor_codex_1",
        diagnostics: {
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          stdoutLines: [],
          stderrLines: [],
          timedOut: false,
        },
        resumed: false,
      })),
      createAdapter("claude", async (request) => {
        if (request.config.thinkingLevel === "ultra") {
          throw new ChatRuntimeError("invalid_config", "unsupported thinking")
        }

        return {
          events: [{ type: "assistant_final", text: "Claude ack" }],
          finalText: "Claude ack",
          vendorSessionId: "vendor_claude_1",
          diagnostics: {
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            stdoutLines: [],
            stderrLines: [],
            timedOut: false,
          },
          resumed: false,
        }
      }),
    ])
    const service = new ChatTurnService(chatService, registry, sessionManager)
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    chatService.updateRuntimeConfig(chat.id, {
      provider: "claude",
      model: "sonnet",
      thinkingLevel: "default",
      permissionLevel: "supervised",
    })

    const result = await service.sendMessage(chat.id, "Use claude")
    expect(result.assistantMessage.contentMarkdown).toBe("Claude ack")

    chatService.updateRuntimeConfig(chat.id, {
      provider: "claude",
      model: "sonnet",
      thinkingLevel: "ultra",
      permissionLevel: "supervised",
    })

    await expect(
      service.sendMessage(chat.id, "bad config"),
    ).rejects.toMatchObject(
      new IpcProtocolError("invalid_request", "unsupported thinking"),
    )

    runtime.close()
  })
})
