import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IPC_PROTOCOL_VERSION, parseIpcResponseEnvelope } from "@ultra/shared"
import { describe, expect, it } from "vitest"

import { ChatService } from "../chats/chat-service.js"
import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "../sandboxes/sandbox-service.js"
import { ThreadService } from "../threads/thread-service.js"
import { startSocketServer } from "./socket-server.js"

async function createServerRuntime(directory: string, socketPath: string) {
  const databaseRuntime = bootstrapDatabase({
    ULTRA_DB_PATH: join(directory, "ultra.db"),
  })
  const sandboxPersistenceService = new SandboxPersistenceService(
    databaseRuntime.database,
  )
  const runtime = await startSocketServer(
    socketPath,
    {
      chatService: new ChatService(databaseRuntime.database),
      projectService: new ProjectService(databaseRuntime.database),
      sandboxService: new SandboxService(sandboxPersistenceService),
      threadService: new ThreadService(databaseRuntime.database),
    },
    {
      info: () => undefined,
      error: () => undefined,
    },
  )

  return {
    runtime,
    databaseRuntime,
    sandboxPersistenceService,
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

    expect(renameResponse.ok).toBe(true)
    expect(pinResponse.ok).toBe(true)
    expect(listResponse.ok).toBe(true)
    expect(getResponse.ok).toBe(true)
    expect(archiveResponse.ok).toBe(true)
    expect(restoreResponse.ok).toBe(true)
    expect(unpinResponse.ok).toBe(true)

    if (listResponse.ok) {
      expect(listResponse.result.chats).toHaveLength(1)
      expect(listResponse.result.chats[0]).toMatchObject({
        title: "Ship M2",
      })
    }

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
    const chatService = new ChatService(databaseRuntime.database)
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

    const planApproval = chatService.createMessage({
      chatId: createChatResponse.result.id,
      role: "user",
      messageType: "plan_approval",
      contentMarkdown: "approve plan",
    })
    const specApproval = chatService.createMessage({
      chatId: createChatResponse.result.id,
      role: "user",
      messageType: "spec_approval",
      contentMarkdown: "approve specs",
    })
    const startRequest = chatService.createMessage({
      chatId: createChatResponse.result.id,
      role: "user",
      messageType: "thread_start_request",
      contentMarkdown: "start work",
    })

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
})
