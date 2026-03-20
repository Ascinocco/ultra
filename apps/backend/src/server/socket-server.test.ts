import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  IPC_PROTOCOL_VERSION,
  parseArtifactSnapshot,
  parseChatsGetMessagesResult,
  parseChatsGetTurnEventsResult,
  parseChatsListTurnsResult,
  parseChatsMessagesEvent,
  parseChatsSendMessageResult,
  parseChatsStartTurnResult,
  parseChatsTurnEventsEvent,
  parseIpcResponseEnvelope,
  parseProjectRuntimeHealthSummary,
  parseProjectRuntimeSnapshot,
  parseRuntimeComponentUpdatedEvent,
  parseRuntimeGetComponentsResult,
  parseRuntimeHealthUpdatedEvent,
  parseRuntimeListGlobalComponentsResult,
  parseRuntimeProjectRuntimeUpdatedEvent,
  parseSubscriptionEventEnvelope,
  parseTerminalOutputEvent,
  parseTerminalSessionsEvent,
  parseThreadsGetMessagesResult,
  parseThreadsMessagesEvent,
} from "@ultra/shared"
import { describe, expect, it } from "vitest"
import { ArtifactCaptureService } from "../artifacts/artifact-capture-service.js"
import { ArtifactPersistenceService } from "../artifacts/artifact-persistence-service.js"
import { ArtifactStorageService } from "../artifacts/artifact-storage-service.js"
import { ChatService } from "../chats/chat-service.js"
import { ChatTurnService } from "../chats/chat-turn-service.js"
import { ChatRuntimeRegistry } from "../chats/runtime/chat-runtime-registry.js"
import { ChatRuntimeSessionManager } from "../chats/runtime/runtime-session-manager.js"
import type { ChatRuntimeAdapter } from "../chats/runtime/types.js"
import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { CoordinatorService } from "../runtime/coordinator-service.js"
import { FakeSupervisedProcessAdapter } from "../runtime/fake-supervised-process-adapter.js"
import { RuntimePersistenceService } from "../runtime/runtime-persistence-service.js"
import { RuntimeRegistry } from "../runtime/runtime-registry.js"
import { RuntimeSupervisor } from "../runtime/runtime-supervisor.js"
import { WatchService } from "../runtime/watch-service.js"
import { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "../sandboxes/sandbox-service.js"
import { FakePtyAdapter } from "../terminal/fake-pty-adapter.js"
import { RuntimeProfileService } from "../terminal/runtime-profile-service.js"
import { RuntimeSyncService } from "../terminal/runtime-sync-service.js"
import { TerminalCommandGenService } from "../terminal/terminal-command-gen-service.js"
import { TerminalService } from "../terminal/terminal-service.js"
import { TerminalSessionService } from "../terminal/terminal-session-service.js"
import { ThreadService } from "../threads/thread-service.js"
import { startSocketServer } from "./socket-server.js"

async function createServerRuntime(directory: string, socketPath: string) {
  const databaseRuntime = bootstrapDatabase({
    ULTRA_DB_PATH: join(directory, "ultra.db"),
  })
  const runtimePersistence = new RuntimePersistenceService(
    databaseRuntime.database,
  )
  const runtimeRegistry = new RuntimeRegistry(runtimePersistence)
  runtimeRegistry.hydrate()
  const processAdapter = new FakeSupervisedProcessAdapter()
  const runtimeSupervisor = new RuntimeSupervisor(
    runtimeRegistry,
    processAdapter,
  )
  const watchService = new WatchService(
    runtimeSupervisor,
    runtimeRegistry,
    databaseRuntime.databasePath,
  )
  const projectService = new ProjectService(databaseRuntime.database)
  const sandboxPersistenceService = new SandboxPersistenceService(
    databaseRuntime.database,
  )
  const sandboxService = new SandboxService(sandboxPersistenceService)
  const threadService = new ThreadService(databaseRuntime.database)
  const chatService = new ChatService(databaseRuntime.database)
  const createAdapter = (provider: "codex" | "claude"): ChatRuntimeAdapter => ({
    provider,
    async runTurn(request) {
      const finalText = `${provider.toUpperCase()} ack: ${request.prompt}`
      return {
        events: [{ type: "assistant_final", text: finalText }],
        finalText,
        vendorSessionId: `${provider}_session_1`,
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
    },
  })
  const chatTurnService = new ChatTurnService(
    chatService,
    new ChatRuntimeRegistry([createAdapter("codex"), createAdapter("claude")]),
    new ChatRuntimeSessionManager(),
  )
  const coordinatorService = new CoordinatorService(
    runtimeSupervisor,
    runtimeRegistry,
    projectService,
    sandboxService,
    threadService,
  )
  threadService.setCoordinatorDispatchHandler({
    sendThreadMessage: (input) => coordinatorService.sendThreadMessage(input),
    startThread: (input) => coordinatorService.startThread(input),
  })
  const runtimeProfileService = new RuntimeProfileService(
    databaseRuntime.database,
    sandboxPersistenceService,
  )
  const terminalService = new TerminalService(
    sandboxService,
    runtimeProfileService,
    new RuntimeSyncService(sandboxPersistenceService),
  )
  const ptyAdapter = new FakePtyAdapter()
  const terminalSessionService = new TerminalSessionService(
    terminalService,
    runtimeProfileService,
    ptyAdapter,
  )
  const terminalCommandGenService = new TerminalCommandGenService()
  const artifactCaptureService = new ArtifactCaptureService(
    new ArtifactStorageService(
      new ArtifactPersistenceService(databaseRuntime.database),
      databaseRuntime.databasePath,
    ),
    sandboxService,
    terminalSessionService,
  )
  sandboxService.setActivationSyncHandler((projectId, sandboxId) => {
    terminalService.syncRuntimeFilesForActivation(projectId, sandboxId)
  })
  const runtime = await startSocketServer(
    socketPath,
    {
      artifactCaptureService,
      chatService,
      chatTurnService,
      coordinatorService,
      projectService,
      runtimeRegistry,
      watchService,
      sandboxService,
      terminalCommandGenService,
      terminalSessionService,
      terminalService,
      threadService,
    },
    {
      info: () => undefined,
      error: () => undefined,
    },
  )

  return {
    runtime,
    artifactCaptureService,
    databaseRuntime,
    projectService,
    processAdapter,
    coordinatorService,
    runtimeRegistry,
    runtimeSupervisor,
    watchService,
    sandboxPersistenceService,
    ptyAdapter,
  }
}

async function request(
  socketPath: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""

    socket.setEncoding("utf8")
    socket.once("error", reject)
    socket.on("data", (chunk) => {
      buffer += chunk

      if (!buffer.includes("\n")) {
        return
      }

      const line = buffer.slice(0, buffer.indexOf("\n")).trim()
      socket.end()
      resolve(JSON.parse(line))
    })
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`)
    })
  })
}

async function openPersistentConnection(socketPath: string): Promise<{
  close: () => Promise<void>
  nextMessage: () => Promise<unknown>
  send: (payload: Record<string, unknown>) => void
}> {
  const socket = createConnection(socketPath)
  let buffer = ""
  const queuedMessages: unknown[] = []
  const waiters: Array<(value: unknown) => void> = []

  socket.setEncoding("utf8")
  socket.on("data", (chunk) => {
    buffer += chunk

    while (buffer.includes("\n")) {
      const newlineIndex = buffer.indexOf("\n")
      const rawLine = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)

      if (!rawLine) {
        continue
      }

      const parsed = JSON.parse(rawLine)
      const waiter = waiters.shift()

      if (waiter) {
        waiter(parsed)
      } else {
        queuedMessages.push(parsed)
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve())
    socket.once("error", reject)
  })

  return {
    send(payload) {
      socket.write(`${JSON.stringify(payload)}\n`)
    },
    nextMessage() {
      const queued = queuedMessages.shift()

      if (queued) {
        return Promise.resolve(queued)
      }

      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    },
    close() {
      socket.end()

      return new Promise((resolve) => {
        socket.once("close", () => resolve())
      })
    },
  }
}

describe("socket server", () => {
  it("round-trips system.hello over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

    const rawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_hello",
      type: "query",
      name: "system.hello",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result).toMatchObject({
        acceptedProtocolVersion: IPC_PROTOCOL_VERSION,
      })
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("returns an explicit unsupported protocol error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

    const rawResponse = await request(socketPath, {
      protocol_version: "0.9",
      request_id: "req_old",
      type: "query",
      name: "system.hello",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBe("unsupported_protocol_version")
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("handles system.ping", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

    const rawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_ping",
      type: "query",
      name: "system.ping",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result).toMatchObject({ status: "ok" })
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips environment readiness queries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

    const rawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_readiness",
      type: "query",
      name: "system.get_environment_readiness",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result).toMatchObject({
        status: expect.any(String),
        checks: expect.any(Array),
      })
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips projects.open, projects.get, and projects.list", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )
    await mkdir(projectDirectory, { recursive: true })

    const openRawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openResponse = parseIpcResponseEnvelope(openRawResponse)

    expect(openResponse.ok).toBe(true)
    if (!openResponse.ok) {
      throw new Error("Expected open response to succeed")
    }

    const getRawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_get",
      type: "query",
      name: "projects.get",
      payload: {
        project_id: openResponse.result.id,
      },
    })
    const listRawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_list",
      type: "query",
      name: "projects.list",
      payload: {},
    })
    const getResponse = parseIpcResponseEnvelope(getRawResponse)
    const listResponse = parseIpcResponseEnvelope(listRawResponse)

    expect(getResponse.ok).toBe(true)
    expect(listResponse.ok).toBe(true)

    if (getResponse.ok) {
      expect(getResponse.result.id).toBe(openResponse.result.id)
    }

    if (listResponse.ok) {
      expect(listResponse.result.projects).toHaveLength(1)
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips chat lifecycle methods over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )
    await mkdir(projectDirectory, { recursive: true })

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open_project",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)

    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    const createChatRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_create",
      type: "command",
      name: "chats.create",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const createChatResponse = parseIpcResponseEnvelope(createChatRaw)
    expect(createChatResponse.ok).toBe(true)
    if (!createChatResponse.ok) {
      throw new Error("Expected chat create to succeed")
    }

    const updateRuntimeConfigRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_update_runtime",
      type: "command",
      name: "chats.update_runtime_config",
      payload: {
        chat_id: createChatResponse.result.id,
        provider: "claude",
        model: "claude-sonnet-4-6",
        thinking_level: "high",
        permission_level: "full_access",
      },
    })
    const invalidUpdateRuntimeConfigRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_update_runtime_invalid",
      type: "command",
      name: "chats.update_runtime_config",
      payload: {
        chat_id: createChatResponse.result.id,
        provider: "openai",
        model: "gpt-5.4",
        thinking_level: "default",
        permission_level: "supervised",
      },
    })
    const renameRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_rename",
      type: "command",
      name: "chats.rename",
      payload: {
        chat_id: createChatResponse.result.id,
        title: "Ship M2",
      },
    })
    const pinRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_pin",
      type: "command",
      name: "chats.pin",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const listRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_list",
      type: "query",
      name: "chats.list",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const getRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_get",
      type: "query",
      name: "chats.get",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const archiveRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_archive",
      type: "command",
      name: "chats.archive",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const restoreRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_restore",
      type: "command",
      name: "chats.restore",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const unpinRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_unpin",
      type: "command",
      name: "chats.unpin",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })

    const renameResponse = parseIpcResponseEnvelope(renameRaw)
    const pinResponse = parseIpcResponseEnvelope(pinRaw)
    const listResponse = parseIpcResponseEnvelope(listRaw)
    const getResponse = parseIpcResponseEnvelope(getRaw)
    const archiveResponse = parseIpcResponseEnvelope(archiveRaw)
    const restoreResponse = parseIpcResponseEnvelope(restoreRaw)
    const unpinResponse = parseIpcResponseEnvelope(unpinRaw)
    const updateRuntimeConfigResponse = parseIpcResponseEnvelope(
      updateRuntimeConfigRaw,
    )
    const invalidUpdateRuntimeConfigResponse = parseIpcResponseEnvelope(
      invalidUpdateRuntimeConfigRaw,
    )

    expect(renameResponse.ok).toBe(true)
    expect(pinResponse.ok).toBe(true)
    expect(listResponse.ok).toBe(true)
    expect(getResponse.ok).toBe(true)
    expect(archiveResponse.ok).toBe(true)
    expect(restoreResponse.ok).toBe(true)
    expect(unpinResponse.ok).toBe(true)
    expect(updateRuntimeConfigResponse.ok).toBe(true)
    expect(invalidUpdateRuntimeConfigResponse.ok).toBe(false)

    if (!invalidUpdateRuntimeConfigResponse.ok) {
      expect(["invalid_request", "internal_error"]).toContain(
        invalidUpdateRuntimeConfigResponse.error.code,
      )
    }

    if (listResponse.ok) {
      expect(listResponse.result.chats).toHaveLength(1)
      expect(listResponse.result.chats[0]).toMatchObject({
        title: "Ship M2",
        provider: "claude",
        model: "claude-sonnet-4-6",
        thinkingLevel: "high",
        permissionLevel: "full_access",
      })
    }

    if (getResponse.ok) {
      expect(getResponse.result).toMatchObject({
        provider: "claude",
        model: "claude-sonnet-4-6",
        thinkingLevel: "high",
        permissionLevel: "full_access",
      })
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips chat messaging and chat message subscriptions over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )
    await mkdir(projectDirectory, { recursive: true })

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open_project_chat_messages",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)
    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    const createChatRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_create_messages",
      type: "command",
      name: "chats.create",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const createChatResponse = parseIpcResponseEnvelope(createChatRaw)
    expect(createChatResponse.ok).toBe(true)
    if (!createChatResponse.ok) {
      throw new Error("Expected chat create to succeed")
    }

    const chatId = createChatResponse.result.id
    const connection = await openPersistentConnection(socketPath)
    connection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_messages_subscribe",
      type: "subscribe",
      name: "chats.messages",
      payload: {
        chat_id: chatId,
      },
    })

    const subscribeResponse = parseIpcResponseEnvelope(
      await connection.nextMessage(),
    )
    expect(subscribeResponse.ok).toBe(true)

    const sendMessageRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_send_message",
      type: "command",
      name: "chats.send_message",
      payload: {
        chat_id: chatId,
        prompt: "Outline next steps.",
      },
    })
    const sendMessageResponse = parseIpcResponseEnvelope(sendMessageRaw)
    expect(sendMessageResponse.ok).toBe(true)
    if (!sendMessageResponse.ok) {
      throw new Error("Expected chat send_message to succeed")
    }

    const sendResult = parseChatsSendMessageResult(sendMessageResponse.result)
    expect(sendResult.userMessage.role).toBe("user")
    expect(sendResult.assistantMessage.role).toBe("assistant")

    const userMessageEvent = parseChatsMessagesEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    const assistantMessageEvent = parseChatsMessagesEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    expect(userMessageEvent.payload.role).toBe("user")
    expect(assistantMessageEvent.payload.role).toBe("assistant")

    const getMessagesRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_get_messages",
      type: "query",
      name: "chats.get_messages",
      payload: {
        chat_id: chatId,
      },
    })
    const getMessagesResponse = parseIpcResponseEnvelope(getMessagesRaw)
    expect(getMessagesResponse.ok).toBe(true)
    if (!getMessagesResponse.ok) {
      throw new Error("Expected chat get_messages to succeed")
    }

    const messages = parseChatsGetMessagesResult(getMessagesResponse.result)
    expect(messages.messages).toHaveLength(2)
    expect(messages.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ])

    await connection.close()
    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips chat turn commands, queries, and turn-event subscriptions over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )
    await mkdir(projectDirectory, { recursive: true })

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open_project_chat_turns",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)
    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    const createChatRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_create_turns",
      type: "command",
      name: "chats.create",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const createChatResponse = parseIpcResponseEnvelope(createChatRaw)
    expect(createChatResponse.ok).toBe(true)
    if (!createChatResponse.ok) {
      throw new Error("Expected chat create to succeed")
    }
    const chatId = createChatResponse.result.id

    const connection = await openPersistentConnection(socketPath)
    connection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_turn_events_subscribe",
      type: "subscribe",
      name: "chats.turn_events",
      payload: {
        chat_id: chatId,
      },
    })
    const subscribeResponse = parseIpcResponseEnvelope(
      await connection.nextMessage(),
    )
    expect(subscribeResponse.ok).toBe(true)

    const startTurnRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_start_turn",
      type: "command",
      name: "chats.start_turn",
      payload: {
        chat_id: chatId,
        prompt: "Queue a durable turn",
        client_turn_id: "client_turn_roundtrip_1",
      },
    })
    const startTurnResponse = parseIpcResponseEnvelope(startTurnRaw)
    expect(startTurnResponse.ok).toBe(true)
    if (!startTurnResponse.ok) {
      throw new Error("Expected chats.start_turn to succeed")
    }
    const startResult = parseChatsStartTurnResult(startTurnResponse.result)
    const receivedTurnEventTypes: string[] = []
    while (!receivedTurnEventTypes.includes("chat.turn_completed")) {
      const turnEvent = parseChatsTurnEventsEvent(
        parseSubscriptionEventEnvelope(await connection.nextMessage()),
      )
      expect(turnEvent.payload.turnId).toBe(startResult.turn.turnId)
      receivedTurnEventTypes.push(turnEvent.payload.eventType)
    }
    expect(receivedTurnEventTypes).toEqual(
      expect.arrayContaining([
        "chat.turn_queued",
        "chat.turn_started",
        "chat.turn_progress",
        "chat.turn_completed",
      ]),
    )

    const getTurnRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_get_turn",
      type: "query",
      name: "chats.get_turn",
      payload: {
        chat_id: chatId,
        turn_id: startResult.turn.turnId,
      },
    })
    const getTurnResponse = parseIpcResponseEnvelope(getTurnRaw)
    expect(getTurnResponse.ok).toBe(true)
    if (!getTurnResponse.ok) {
      throw new Error("Expected chats.get_turn to succeed")
    }
    expect(getTurnResponse.result.turnId).toBe(startResult.turn.turnId)
    expect(getTurnResponse.result.status).toBe("succeeded")

    const listTurnsRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_list_turns",
      type: "query",
      name: "chats.list_turns",
      payload: {
        chat_id: chatId,
        limit: 10,
      },
    })
    const listTurnsResponse = parseIpcResponseEnvelope(listTurnsRaw)
    expect(listTurnsResponse.ok).toBe(true)
    if (!listTurnsResponse.ok) {
      throw new Error("Expected chats.list_turns to succeed")
    }
    const listTurnsResult = parseChatsListTurnsResult(listTurnsResponse.result)
    expect(listTurnsResult.turns.map((turn) => turn.turnId)).toEqual([
      startResult.turn.turnId,
    ])

    const getTurnEventsRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_get_turn_events",
      type: "query",
      name: "chats.get_turn_events",
      payload: {
        chat_id: chatId,
        turn_id: startResult.turn.turnId,
      },
    })
    const getTurnEventsResponse = parseIpcResponseEnvelope(getTurnEventsRaw)
    expect(getTurnEventsResponse.ok).toBe(true)
    if (!getTurnEventsResponse.ok) {
      throw new Error("Expected chats.get_turn_events to succeed")
    }
    const initialEvents = parseChatsGetTurnEventsResult(
      getTurnEventsResponse.result,
    )
    expect(initialEvents.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "chat.turn_queued",
        "chat.turn_started",
        "chat.turn_progress",
        "chat.turn_completed",
      ]),
    )
    const fromSequence = initialEvents.events[1]?.sequenceNumber ?? 1
    const replayFromSequenceRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_get_turn_events_from_sequence",
      type: "query",
      name: "chats.get_turn_events",
      payload: {
        chat_id: chatId,
        turn_id: startResult.turn.turnId,
        from_sequence: fromSequence,
      },
    })
    const replayFromSequenceResponse = parseIpcResponseEnvelope(
      replayFromSequenceRaw,
    )
    expect(replayFromSequenceResponse.ok).toBe(true)
    if (!replayFromSequenceResponse.ok) {
      throw new Error("Expected chats.get_turn_events from sequence to succeed")
    }
    const replayFromSequence = parseChatsGetTurnEventsResult(
      replayFromSequenceResponse.result,
    )
    expect(
      replayFromSequence.events.every(
        (event) => event.sequenceNumber > fromSequence,
      ),
    ).toBe(true)
    expect(replayFromSequence.events.length).toBeGreaterThan(0)

    await connection.close()
    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips thread creation and thread queries over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )
    await mkdir(projectDirectory, { recursive: true })

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open_project_threads",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)

    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    const createChatRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_for_thread",
      type: "command",
      name: "chats.create",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const createChatResponse = parseIpcResponseEnvelope(createChatRaw)

    expect(createChatResponse.ok).toBe(true)
    if (!createChatResponse.ok) {
      throw new Error("Expected chat create to succeed")
    }

    const approvePlanRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_approve_plan",
      type: "command",
      name: "chats.approve_plan",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const approvePlanResponse = parseIpcResponseEnvelope(approvePlanRaw)
    expect(approvePlanResponse.ok).toBe(true)
    if (!approvePlanResponse.ok) {
      throw new Error("Expected plan approval to succeed")
    }

    const approveSpecsRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_approve_specs",
      type: "command",
      name: "chats.approve_specs",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const approveSpecsResponse = parseIpcResponseEnvelope(approveSpecsRaw)
    expect(approveSpecsResponse.ok).toBe(true)
    if (!approveSpecsResponse.ok) {
      throw new Error("Expected specs approval to succeed")
    }

    const planApproval = approvePlanResponse.result
    const specApproval = approveSpecsResponse.result

    expect(planApproval.messageType).toBe("plan_approval")
    expect(specApproval.messageType).toBe("spec_approval")

    const getMessagesBeforeStartRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_get_chat_messages_before_start",
      type: "query",
      name: "chats.get_messages",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const getMessagesBeforeStartResponse = parseIpcResponseEnvelope(
      getMessagesBeforeStartRaw,
    )
    expect(getMessagesBeforeStartResponse.ok).toBe(true)
    if (!getMessagesBeforeStartResponse.ok) {
      throw new Error("Expected chat message query to succeed")
    }
    expect(getMessagesBeforeStartResponse.result.messages).toHaveLength(2)

    const startThreadRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_start_thread",
      type: "command",
      name: "chats.start_thread",
      payload: {
        chat_id: createChatResponse.result.id,
        title: "Socket thread",
        summary: "Created via socket",
        plan_approval_message_id: planApproval.id,
        spec_approval_message_id: specApproval.id,
        confirm_start: true,
        spec_refs: [],
        ticket_refs: [],
      },
    })
    const startThreadResponse = parseIpcResponseEnvelope(startThreadRaw)

    expect(startThreadResponse.ok).toBe(true)
    if (!startThreadResponse.ok) {
      throw new Error("Expected thread start to succeed")
    }

    const listByProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_threads_by_project",
      type: "query",
      name: "threads.list_by_project",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const getThreadRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_thread_get",
      type: "query",
      name: "threads.get",
      payload: {
        thread_id: startThreadResponse.result.thread.id,
      },
    })
    const getEventsRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_thread_events",
      type: "query",
      name: "threads.get_events",
      payload: {
        thread_id: startThreadResponse.result.thread.id,
      },
    })

    const listByProjectResponse = parseIpcResponseEnvelope(listByProjectRaw)
    const getThreadResponse = parseIpcResponseEnvelope(getThreadRaw)
    const getEventsResponse = parseIpcResponseEnvelope(getEventsRaw)

    expect(listByProjectResponse.ok).toBe(true)
    expect(getThreadResponse.ok).toBe(true)
    expect(getEventsResponse.ok).toBe(true)

    if (listByProjectResponse.ok) {
      expect(listByProjectResponse.result.threads).toHaveLength(1)
    }

    if (getThreadResponse.ok) {
      expect(getThreadResponse.result.thread.id).toBe(
        startThreadResponse.result.thread.id,
      )
    }

    if (getEventsResponse.ok) {
      expect(getEventsResponse.result.events).toEqual([
        expect.objectContaining({
          eventType: "thread.created",
          sequenceNumber: 1,
        }),
      ])
    }

    const getMessagesAfterStartRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_get_chat_messages_after_start",
      type: "query",
      name: "chats.get_messages",
      payload: {
        chat_id: createChatResponse.result.id,
      },
    })
    const getMessagesAfterStartResponse = parseIpcResponseEnvelope(
      getMessagesAfterStartRaw,
    )
    expect(getMessagesAfterStartResponse.ok).toBe(true)
    if (!getMessagesAfterStartResponse.ok) {
      throw new Error("Expected chat message query after start to succeed")
    }
    expect(
      getMessagesAfterStartResponse.result.messages.some(
        (message: { messageType?: string }) =>
          message.messageType === "thread_start_request",
      ),
    ).toBe(true)

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips thread message reads and live updates over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime, processAdapter } =
      await createServerRuntime(directory, socketPath)
    const chatService = new ChatService(databaseRuntime.database)
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(join(projectDirectory, "package.json"), "{}")

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open_project_thread_messages",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)
    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    const createChatRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_for_thread_messages",
      type: "command",
      name: "chats.create",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const createChatResponse = parseIpcResponseEnvelope(createChatRaw)
    expect(createChatResponse.ok).toBe(true)
    if (!createChatResponse.ok) {
      throw new Error("Expected chat create to succeed")
    }

    const planApproval = chatService.appendMessage({
      chatId: createChatResponse.result.id,
      role: "user",
      messageType: "plan_approval",
      contentMarkdown: "approve plan",
    })
    const specApproval = chatService.appendMessage({
      chatId: createChatResponse.result.id,
      role: "user",
      messageType: "spec_approval",
      contentMarkdown: "approve specs",
    })
    const startRequest = chatService.appendMessage({
      chatId: createChatResponse.result.id,
      role: "user",
      messageType: "thread_start_request",
      contentMarkdown: "start work",
    })

    const startThreadRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_start_thread_messages",
      type: "command",
      name: "chats.start_thread",
      payload: {
        chat_id: createChatResponse.result.id,
        title: "Socket thread",
        summary: "Created via socket",
        plan_approval_message_id: planApproval.id,
        spec_approval_message_id: specApproval.id,
        start_request_message_id: startRequest.id,
        spec_refs: [],
        ticket_refs: [],
      },
    })
    const startThreadResponse = parseIpcResponseEnvelope(startThreadRaw)
    expect(startThreadResponse.ok).toBe(true)
    if (!startThreadResponse.ok) {
      throw new Error("Expected thread start to succeed")
    }

    const coordinatorSpawn = processAdapter.spawns.find(
      ({ spec }) => spec.componentType === "coordinator",
    )
    expect(coordinatorSpawn).toBeDefined()
    if (!coordinatorSpawn) {
      throw new Error("Expected coordinator spawn")
    }

    const threadId = startThreadResponse.result.thread.id
    const connection = await openPersistentConnection(socketPath)
    connection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_thread_messages_subscribe",
      type: "subscribe",
      name: "threads.messages",
      payload: {
        thread_id: threadId,
      },
    })

    const subscribeResponse = parseIpcResponseEnvelope(
      await connection.nextMessage(),
    )
    expect(subscribeResponse.ok).toBe(true)

    const sendMessageRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_thread_send_message",
      type: "command",
      name: "threads.send_message",
      payload: {
        project_id: openProjectResponse.result.id,
        thread_id: threadId,
        content: "Please rerun tests before review.",
        attachments: [],
      },
    })
    const sendMessageResponse = parseIpcResponseEnvelope(sendMessageRaw)
    expect(sendMessageResponse.ok).toBe(true)

    const userMessageEvent = parseThreadsMessagesEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    expect(userMessageEvent.payload.role).toBe("user")
    expect(userMessageEvent.payload.content.text).toBe(
      "Please rerun tests before review.",
    )

    coordinatorSpawn.handle.emitStdoutLine(
      JSON.stringify({
        kind: "event",
        protocol_version: "1.0",
        event_id: "coord_evt_thread_message",
        sequence_number: 1,
        event_type: "thread_message_emitted",
        project_id: openProjectResponse.result.id,
        coordinator_id: `coord_${openProjectResponse.result.id}`,
        coordinator_instance_id: "coord_instance_1",
        thread_id: threadId,
        occurred_at: "2026-03-17T20:10:00.000Z",
        payload: {
          message_id: "thread_msg_assistant_1",
          role: "assistant",
          message_type: "assistant_text",
          content_markdown: "Tests are rerunning now.",
          attachments: [],
        },
      }),
    )

    const assistantMessageEvent = parseThreadsMessagesEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    expect(assistantMessageEvent.payload.role).toBe("coordinator")

    const getMessagesRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_thread_get_messages",
      type: "query",
      name: "threads.get_messages",
      payload: {
        thread_id: threadId,
      },
    })
    const getMessagesResponse = parseIpcResponseEnvelope(getMessagesRaw)
    expect(getMessagesResponse.ok).toBe(true)
    if (!getMessagesResponse.ok) {
      throw new Error("Expected thread message read to succeed")
    }

    const messages = parseThreadsGetMessagesResult(getMessagesResponse.result)
    expect(messages.messages).toHaveLength(2)
    expect(messages.messages.map((message) => message.role)).toEqual([
      "user",
      "coordinator",
    ])

    await connection.close()
    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips sandbox list/get_active/set_active over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime, sandboxPersistenceService } =
      await createServerRuntime(directory, socketPath)
    await mkdir(projectDirectory, { recursive: true })

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_sandbox_open_project",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)

    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    const listRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_sandbox_list",
      type: "query",
      name: "sandboxes.list",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const activeRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_sandbox_active",
      type: "query",
      name: "sandboxes.get_active",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })

    const listResponse = parseIpcResponseEnvelope(listRaw)
    const activeResponse = parseIpcResponseEnvelope(activeRaw)

    expect(listResponse.ok).toBe(true)
    expect(activeResponse.ok).toBe(true)

    if (!listResponse.ok || !activeResponse.ok) {
      throw new Error("Expected sandbox reads to succeed")
    }

    expect(listResponse.result.sandboxes).toHaveLength(1)
    expect(activeResponse.result).toMatchObject({
      sandboxType: "main_checkout",
      isMainCheckout: true,
      path: openProjectResponse.result.rootPath,
    })

    databaseRuntime.database
      .prepare(
        "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "chat_1",
        openProjectResponse.result.id,
        "Chat 1",
        "active",
        "codex",
        "gpt-5-codex",
        "standard",
        "supervised",
        "2026-03-15T19:30:00Z",
        "2026-03-15T19:30:00Z",
      )
    databaseRuntime.database
      .prepare(
        "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "thread_1",
        openProjectResponse.result.id,
        "chat_1",
        "Thread 1",
        "queued",
        "not_ready",
        "not_requested",
        "2026-03-15T19:30:00Z",
        "2026-03-15T19:30:00Z",
      )
    const threadSandbox = sandboxPersistenceService.upsertThreadSandbox({
      projectId: openProjectResponse.result.id,
      threadId: "thread_1",
      path: join(projectDirectory, ".sandbox-thread-1"),
      displayName: "Thread 1 Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })

    const setActiveRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_sandbox_set_active",
      type: "command",
      name: "sandboxes.set_active",
      payload: {
        project_id: openProjectResponse.result.id,
        sandbox_id: threadSandbox.sandboxId,
      },
    })
    const setActiveResponse = parseIpcResponseEnvelope(setActiveRaw)

    expect(setActiveResponse.ok).toBe(true)
    if (setActiveResponse.ok) {
      expect(setActiveResponse.result.sandboxId).toBe(threadSandbox.sandboxId)
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips terminal runtime profile and sync methods over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const sandboxDirectory = join(projectDirectory, ".sandbox-thread-1")
    const { runtime, databaseRuntime, sandboxPersistenceService } =
      await createServerRuntime(directory, socketPath)
    await mkdir(projectDirectory, { recursive: true })
    await mkdir(sandboxDirectory, { recursive: true })
    await writeFile(join(projectDirectory, ".env"), "API_KEY=socket\n")

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_open_project",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)

    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    databaseRuntime.database
      .prepare(
        "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "chat_terminal",
        openProjectResponse.result.id,
        "Terminal Chat",
        "active",
        "codex",
        "gpt-5-codex",
        "standard",
        "supervised",
        "2026-03-15T20:45:00Z",
        "2026-03-15T20:45:00Z",
      )
    databaseRuntime.database
      .prepare(
        "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "thread_terminal",
        openProjectResponse.result.id,
        "chat_terminal",
        "Terminal Thread",
        "queued",
        "not_ready",
        "not_requested",
        "2026-03-15T20:45:00Z",
        "2026-03-15T20:45:00Z",
      )

    const threadSandbox = sandboxPersistenceService.upsertThreadSandbox({
      projectId: openProjectResponse.result.id,
      threadId: "thread_terminal",
      path: sandboxDirectory,
      displayName: "Terminal Sandbox",
      branchName: "thread/terminal",
      baseBranch: "main",
    })

    const profileRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_profile",
      type: "query",
      name: "terminal.get_runtime_profile",
      payload: {
        project_id: openProjectResponse.result.id,
        sandbox_id: threadSandbox.sandboxId,
      },
    })
    const syncRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_sync",
      type: "command",
      name: "terminal.sync_runtime_files",
      payload: {
        project_id: openProjectResponse.result.id,
        sandbox_id: threadSandbox.sandboxId,
      },
    })

    const profileResponse = parseIpcResponseEnvelope(profileRaw)
    const syncResponse = parseIpcResponseEnvelope(syncRaw)

    expect(profileResponse.ok).toBe(true)
    expect(syncResponse.ok).toBe(true)

    if (profileResponse.ok) {
      expect(profileResponse.result.sync.status).toBe("unknown")
    }

    if (syncResponse.ok) {
      expect(syncResponse.result.sync.status).toBe("synced")
      expect(syncResponse.result.sync.syncedFiles).toEqual([".env"])
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips global runtime queries and component update subscriptions over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime, processAdapter, watchService } =
      await createServerRuntime(directory, socketPath)

    const initialListRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_globals_initial",
      type: "query",
      name: "runtime.list_global_components",
      payload: {},
    })
    const initialListResponse = parseIpcResponseEnvelope(initialListRaw)

    expect(initialListResponse.ok).toBe(true)
    if (!initialListResponse.ok) {
      throw new Error("Expected runtime.list_global_components to succeed")
    }

    expect(
      parseRuntimeListGlobalComponentsResult(initialListResponse.result)
        .components,
    ).toHaveLength(0)

    const connection = await openPersistentConnection(socketPath)

    connection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_component_subscribe",
      type: "subscribe",
      name: "runtime.component_updated",
      payload: {},
    })

    const subscribeResponse = parseIpcResponseEnvelope(
      await connection.nextMessage(),
    )
    expect(subscribeResponse.ok).toBe(true)

    const startedComponent = watchService.ensureRunning()
    const startedEvent = parseRuntimeComponentUpdatedEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )

    expect(startedEvent.payload.componentId).toBe(startedComponent.componentId)
    expect(startedEvent.payload.componentType).toBe("ov_watch")
    expect(startedEvent.payload.projectId).toBeNull()
    expect(startedEvent.payload.status).toBe("healthy")

    processAdapter.spawns[0]?.handle.emitExit({
      code: 1,
      signal: null,
    })

    const degradedEvent = parseRuntimeComponentUpdatedEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    expect(degradedEvent.payload.componentId).toBe(startedComponent.componentId)
    expect(degradedEvent.payload.status).toBe("degraded")

    let recoveredEvent = parseRuntimeComponentUpdatedEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )

    if (recoveredEvent.payload.status !== "healthy") {
      recoveredEvent = parseRuntimeComponentUpdatedEvent(
        parseSubscriptionEventEnvelope(await connection.nextMessage()),
      )
    }

    expect(recoveredEvent.payload.componentId).toBe(
      startedComponent.componentId,
    )
    expect(recoveredEvent.payload.status).toBe("healthy")

    const listRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_globals_after_start",
      type: "query",
      name: "runtime.list_global_components",
      payload: {},
    })
    const listResponse = parseIpcResponseEnvelope(listRaw)

    expect(listResponse.ok).toBe(true)
    if (!listResponse.ok) {
      throw new Error("Expected runtime.list_global_components to succeed")
    }

    const result = parseRuntimeListGlobalComponentsResult(listResponse.result)
    expect(result.components).toHaveLength(1)
    expect(result.components[0]?.componentType).toBe("ov_watch")

    await connection.close()
    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips project runtime queries and project-scoped runtime subscriptions over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const secondProjectDirectory = join(directory, "repo-b")
    const { runtime, databaseRuntime, projectService, runtimeRegistry } =
      await createServerRuntime(directory, socketPath)

    await mkdir(projectDirectory, { recursive: true })
    await mkdir(secondProjectDirectory, { recursive: true })
    const project = projectService.open({ path: projectDirectory })
    const secondProject = projectService.open({ path: secondProjectDirectory })

    runtimeRegistry.ensureProjectRuntime(project.id)
    runtimeRegistry.upsertRuntimeComponent({
      componentType: "coordinator",
      details: {
        coordinatorId: "coord_proj_a",
      },
      lastHeartbeatAt: "2026-03-17T15:00:00Z",
      processId: 101,
      projectId: project.id,
      restartCount: 1,
      scope: "project",
      startedAt: "2026-03-17T14:59:00Z",
      status: "healthy",
    })
    runtimeRegistry.upsertProjectRuntime({
      coordinatorId: "coord_proj_a",
      coordinatorInstanceId: "coord_instance_a",
      lastHeartbeatAt: "2026-03-17T15:00:00Z",
      projectId: project.id,
      restartCount: 1,
      startedAt: "2026-03-17T14:59:00Z",
      status: "running",
    })

    const healthRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_project_health",
      type: "query",
      name: "runtime.get_project_health",
      payload: {
        project_id: project.id,
      },
    })
    const runtimeRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_project_runtime",
      type: "query",
      name: "runtime.get_project_runtime",
      payload: {
        project_id: project.id,
      },
    })
    const componentsRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_project_components",
      type: "query",
      name: "runtime.get_components",
      payload: {
        project_id: project.id,
      },
    })
    const missingRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_project_missing",
      type: "query",
      name: "runtime.get_project_health",
      payload: {
        project_id: "proj_missing",
      },
    })

    const healthResponse = parseIpcResponseEnvelope(healthRaw)
    const runtimeResponse = parseIpcResponseEnvelope(runtimeRaw)
    const componentsResponse = parseIpcResponseEnvelope(componentsRaw)
    const missingResponse = parseIpcResponseEnvelope(missingRaw)

    expect(healthResponse.ok).toBe(true)
    expect(runtimeResponse.ok).toBe(true)
    expect(componentsResponse.ok).toBe(true)
    expect(missingResponse.ok).toBe(false)

    if (!healthResponse.ok || !runtimeResponse.ok || !componentsResponse.ok) {
      throw new Error("Expected project runtime queries to succeed")
    }

    expect(parseProjectRuntimeHealthSummary(healthResponse.result)).toEqual(
      expect.objectContaining({
        projectId: project.id,
        status: "healthy",
      }),
    )
    expect(parseProjectRuntimeSnapshot(runtimeResponse.result)).toEqual(
      expect.objectContaining({
        projectId: project.id,
        status: "running",
      }),
    )
    expect(parseRuntimeGetComponentsResult(componentsResponse.result)).toEqual(
      expect.objectContaining({
        components: [
          expect.objectContaining({
            componentType: "coordinator",
            projectId: project.id,
          }),
        ],
      }),
    )

    const runtimeConnection = await openPersistentConnection(socketPath)
    const healthConnection = await openPersistentConnection(socketPath)
    const unrelatedRuntimeConnection =
      await openPersistentConnection(socketPath)
    const unrelatedHealthConnection = await openPersistentConnection(socketPath)

    runtimeConnection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_project_subscribe",
      type: "subscribe",
      name: "runtime.project_runtime_updated",
      payload: {
        project_id: project.id,
      },
    })
    healthConnection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_health_subscribe",
      type: "subscribe",
      name: "runtime.health_updated",
      payload: {
        project_id: project.id,
      },
    })
    unrelatedRuntimeConnection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_project_subscribe_other",
      type: "subscribe",
      name: "runtime.project_runtime_updated",
      payload: {
        project_id: secondProject.id,
      },
    })
    unrelatedHealthConnection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_runtime_health_subscribe_other",
      type: "subscribe",
      name: "runtime.health_updated",
      payload: {
        project_id: secondProject.id,
      },
    })

    expect(
      parseIpcResponseEnvelope(await runtimeConnection.nextMessage()).ok,
    ).toBe(true)
    expect(
      parseIpcResponseEnvelope(await healthConnection.nextMessage()).ok,
    ).toBe(true)

    expect(
      parseIpcResponseEnvelope(await unrelatedRuntimeConnection.nextMessage())
        .ok,
    ).toBe(true)
    expect(
      parseIpcResponseEnvelope(await unrelatedHealthConnection.nextMessage())
        .ok,
    ).toBe(true)

    const unrelatedRuntimeEvent = await Promise.race([
      unrelatedRuntimeConnection.nextMessage().then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 50)
      }),
    ])
    const unrelatedHealthEvent = await Promise.race([
      unrelatedHealthConnection.nextMessage().then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 50)
      }),
    ])

    expect(unrelatedRuntimeEvent).toBe(false)
    expect(unrelatedHealthEvent).toBe(false)

    runtimeRegistry.upsertProjectRuntime({
      coordinatorId: "coord_proj_a",
      coordinatorInstanceId: "coord_instance_a_2",
      lastHeartbeatAt: "2026-03-17T15:03:00Z",
      projectId: project.id,
      restartCount: 2,
      startedAt: "2026-03-17T14:59:00Z",
      status: "running",
    })
    runtimeRegistry.upsertRuntimeComponent({
      componentType: "watchdog",
      details: {
        probeState: "suspect",
      },
      lastHeartbeatAt: "2026-03-17T15:03:30Z",
      processId: 202,
      projectId: project.id,
      reason: "Heartbeat missed.",
      restartCount: 0,
      scope: "project",
      startedAt: "2026-03-17T15:03:00Z",
      status: "degraded",
    })

    const projectRuntimeEvent = parseRuntimeProjectRuntimeUpdatedEvent(
      parseSubscriptionEventEnvelope(await runtimeConnection.nextMessage()),
    )
    const healthEvent = parseRuntimeHealthUpdatedEvent(
      parseSubscriptionEventEnvelope(await healthConnection.nextMessage()),
    )

    expect(projectRuntimeEvent.payload.projectId).toBe(project.id)
    expect(projectRuntimeEvent.payload.coordinatorInstanceId).toBe(
      "coord_instance_a_2",
    )
    expect(healthEvent.payload.projectId).toBe(project.id)
    expect(healthEvent.payload.status).toBe("degraded")

    await runtimeConnection.close()
    await healthConnection.close()
    await unrelatedRuntimeConnection.close()
    await unrelatedHealthConnection.close()
    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("publishes terminal session and output subscriptions over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime, ptyAdapter } = await createServerRuntime(
      directory,
      socketPath,
    )
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(join(projectDirectory, ".env"), "API_KEY=socket\n")

    const openProjectRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_subscriptions_project",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openProjectResponse = parseIpcResponseEnvelope(openProjectRaw)

    expect(openProjectResponse.ok).toBe(true)
    if (!openProjectResponse.ok) {
      throw new Error("Expected project open to succeed")
    }

    const connection = await openPersistentConnection(socketPath)

    connection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_sessions_subscribe",
      type: "subscribe",
      name: "terminal.sessions",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })

    const subscribeResponse = parseIpcResponseEnvelope(
      await connection.nextMessage(),
    )
    expect(subscribeResponse.ok).toBe(true)
    if (!subscribeResponse.ok) {
      throw new Error("Expected terminal.sessions subscription to succeed")
    }

    const initialSessionsEvent = parseTerminalSessionsEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    expect(initialSessionsEvent.payload.sessions).toHaveLength(0)

    const openTerminalRaw = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_open",
      type: "command",
      name: "terminal.open",
      payload: {
        project_id: openProjectResponse.result.id,
      },
    })
    const openTerminalResponse = parseIpcResponseEnvelope(openTerminalRaw)

    expect(openTerminalResponse.ok).toBe(true)
    if (!openTerminalResponse.ok) {
      throw new Error("Expected terminal.open to succeed")
    }

    const sessionsEvent = parseTerminalSessionsEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    const openedSession = sessionsEvent.payload.sessions[0]

    expect(openedSession?.sessionKind).toBe("shell")

    connection.send({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_output_subscribe",
      type: "subscribe",
      name: "terminal.output",
      payload: {
        project_id: openProjectResponse.result.id,
        session_id: openTerminalResponse.result.sessionId,
      },
    })

    const outputSubscribeResponse = parseIpcResponseEnvelope(
      await connection.nextMessage(),
    )
    expect(outputSubscribeResponse.ok).toBe(true)

    ptyAdapter.sessions[0]?.emitData("hello from shell")

    const outputEvent = parseTerminalOutputEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    expect(outputEvent.payload.session_id).toBe(
      openTerminalResponse.result.sessionId,
    )
    expect(outputEvent.payload.chunk).toBe("hello from shell")
    expect(outputEvent.payload.sequence_number).toBe(1)

    await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_close",
      type: "command",
      name: "terminal.close_session",
      payload: {
        project_id: openProjectResponse.result.id,
        session_id: openTerminalResponse.result.sessionId,
      },
    })

    const closedSessionsEvent = parseTerminalSessionsEvent(
      parseSubscriptionEventEnvelope(await connection.nextMessage()),
    )
    expect(closedSessionsEvent.payload.sessions[0]?.status).toBe("exited")

    await connection.close()
    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips artifacts.capture_runtime over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime, sandboxPersistenceService, ptyAdapter } =
      await createServerRuntime(directory, socketPath)
    const projectService = new ProjectService(databaseRuntime.database)
    const projectPath = join(directory, "project-one")

    await mkdir(projectPath, { recursive: true })

    const project = projectService.open({ path: projectPath })

    await mkdir(join(project.rootPath, ".sandbox-thread-1"), {
      recursive: true,
    })
    await writeFile(join(project.rootPath, ".env"), "API_KEY=socket\n")
    databaseRuntime.database
      .prepare(
        "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "chat_1",
        project.id,
        "Chat 1",
        "active",
        "codex",
        "gpt-5-codex",
        "standard",
        "supervised",
        "2026-03-16T19:00:00Z",
        "2026-03-16T19:00:00Z",
      )
    databaseRuntime.database
      .prepare(
        "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "thread_1",
        project.id,
        "chat_1",
        "Thread 1",
        "queued",
        "not_ready",
        "not_requested",
        "2026-03-16T19:00:00Z",
        "2026-03-16T19:00:00Z",
      )

    const threadSandbox = sandboxPersistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: join(project.rootPath, ".sandbox-thread-1"),
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const opened = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open",
      type: "command",
      name: "terminal.open",
      payload: {
        project_id: project.id,
        sandbox_id: threadSandbox.sandboxId,
      },
    })
    const openResponse = parseIpcResponseEnvelope(opened)

    expect(openResponse.ok).toBe(true)
    if (!openResponse.ok) {
      throw new Error("Expected terminal.open to succeed.")
    }

    const sessionId = (openResponse.result as { sessionId: string }).sessionId
    ptyAdapter.sessions[0]?.emitData("socket capture output")

    const rawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_capture",
      type: "command",
      name: "artifacts.capture_runtime",
      payload: {
        project_id: project.id,
        session_id: sessionId,
      },
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(true)
    if (response.ok) {
      const artifact = parseArtifactSnapshot(response.result)
      expect(artifact.artifactType).toBe("terminal_output_bundle")
      expect(artifact.metadata.payload.output).toBe("socket capture output")
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })
})
