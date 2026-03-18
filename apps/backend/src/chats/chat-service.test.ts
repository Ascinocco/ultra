import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { ChatService } from "./chat-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  directory: string
  databasePath: string
  projectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-chat-service-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    directory,
    databasePath: join(directory, "ultra.db"),
    projectPath,
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()

    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("ChatService", () => {
  it("creates a chat, initial session, and current session link", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )
    const chatService = new ChatService(
      runtime.database,
      () => "2026-03-15T12:00:00Z",
    )
    const project = projectService.open({ path: projectPath })

    const chat = chatService.create(project.id)
    const sessionRows = chatService.listSessions(chat.id)

    expect(chat.title).toBe("Untitled Chat")
    expect(chat.currentSessionId).toBe(sessionRows[0]?.id)
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0]).toMatchObject({
      chatId: chat.id,
      sequenceNumber: 1,
    })

    runtime.close()
  })

  it("lists chats pinned-first and updated descending", () => {
    const { databasePath, projectPath, directory } = createWorkspace()
    const secondProjectPath = join(directory, "project-two")
    mkdirSync(secondProjectPath)
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T12:00:0${tick}Z`
    }
    const projectService = new ProjectService(runtime.database, now)
    const chatService = new ChatService(runtime.database, now)
    const project = projectService.open({ path: projectPath })
    projectService.open({ path: secondProjectPath })

    const first = chatService.create(project.id)
    const second = chatService.create(project.id)
    chatService.pin(first.id)
    const chats = chatService.list(project.id)

    expect(chats.chats.map((chat) => chat.id)).toEqual([first.id, second.id])

    runtime.close()
  })

  it("persists rename, pin, archive, and restore across reload", () => {
    const { databasePath, projectPath } = createWorkspace()
    const firstRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(firstRuntime.database)
    const chatService = new ChatService(
      firstRuntime.database,
      () => "2026-03-15T12:00:00Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    chatService.rename(chat.id, "Plan chat")
    chatService.pin(chat.id)
    chatService.archive(chat.id)
    firstRuntime.close()

    const secondRuntime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const secondService = new ChatService(
      secondRuntime.database,
      () => "2026-03-15T12:10:00Z",
    )
    const archived = secondService.get(chat.id)
    const restored = secondService.restore(chat.id)

    expect(archived.title).toBe("Plan chat")
    expect(archived.isPinned).toBe(true)
    expect(archived.status).toBe("archived")
    expect(restored.status).toBe("active")
    expect(restored.archivedAt).toBeNull()

    secondRuntime.close()
  })

  it("returns not_found for unknown chat ids", () => {
    const { databasePath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const service = new ChatService(runtime.database)

    expect(() => service.get("chat_missing")).toThrow(/Chat not found/)

    runtime.close()
  })

  it("rejects empty rename input and exposes internal read helpers", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    expect(() => service.rename(chat.id, "   ")).toThrow(/must not be empty/)
    expect(service.listMessages(chat.id)).toEqual([])
    expect(service.listThreadRefs(chat.id)).toEqual([])
    expect(service.listChatRefs(chat.id)).toEqual([])

    runtime.close()
  })

  it("publishes appended messages to chat subscribers and supports unsubscribe", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(runtime.database)
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)
    const received: string[] = []

    const unsubscribe = service.subscribeToMessages(chat.id, (message) => {
      received.push(message.id)
    })

    const first = service.appendMessage({
      chatId: chat.id,
      role: "user",
      messageType: "user_text",
      contentMarkdown: "First",
    })

    unsubscribe()

    service.appendMessage({
      chatId: chat.id,
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Second",
    })

    expect(received).toEqual([first.id])

    runtime.close()
  })

  it("updates runtime config and persists provider changes", () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const service = new ChatService(
      runtime.database,
      () => "2026-03-15T12:15:00Z",
    )
    const project = projectService.open({ path: projectPath })
    const chat = service.create(project.id)

    const updated = service.updateRuntimeConfig(chat.id, {
      provider: "claude",
      model: "sonnet",
      thinkingLevel: "medium",
      permissionLevel: "full_access",
    })

    expect(updated).toMatchObject({
      provider: "claude",
      model: "sonnet",
      thinkingLevel: "medium",
      permissionLevel: "full_access",
    })

    runtime.close()
  })
})
