import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { bootstrapDatabase } from "../../db/database.js"
import { ProjectService } from "../../projects/project-service.js"
import { ChatService } from "../chat-service.js"
import { ChatTurnService } from "../chat-turn-service.js"
import { ChatRuntimeRegistry } from "./chat-runtime-registry.js"
import { ClaudeChatRuntimeAdapter } from "./claude-chat-runtime-adapter.js"
import { CodexChatRuntimeAdapter } from "./codex-chat-runtime-adapter.js"
import { SpawnRuntimeProcessRunner } from "./process-runner.js"
import { ChatRuntimeSessionManager } from "./runtime-session-manager.js"

const temporaryDirectories: string[] = []
const maybeDescribe =
  process.env.ULTRA_RUN_LIVE_RUNTIME_TESTS === "1" ? describe : describe.skip

function createWorkspace(): {
  databasePath: string
  projectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-chat-runtime-live-"))
  const projectPath = join(directory, "project")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
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

maybeDescribe("live chat runtime adapters", () => {
  it("supports a two-turn codex conversation with resume", async () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(runtime.database)
    const service = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        new CodexChatRuntimeAdapter(new SpawnRuntimeProcessRunner()),
      ]),
      new ChatRuntimeSessionManager(),
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    const first = await service.sendMessage(chat.id, "Reply with exactly OK.")
    const second = await service.sendMessage(
      chat.id,
      "Reply with exactly AGAIN.",
    )

    expect(first.assistantMessage.contentMarkdown).toContain("OK")
    expect(second.assistantMessage.contentMarkdown).toContain("AGAIN")

    runtime.close()
  })

  it("supports a two-turn claude conversation with resume", async () => {
    const { databasePath, projectPath } = createWorkspace()
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const chatService = new ChatService(runtime.database)
    const service = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        new ClaudeChatRuntimeAdapter(new SpawnRuntimeProcessRunner()),
      ]),
      new ChatRuntimeSessionManager(),
    )
    const project = projectService.open({ path: projectPath })
    const chat = chatService.create(project.id)

    chatService.updateRuntimeConfig(chat.id, {
      provider: "claude",
      model: process.env.ULTRA_LIVE_CLAUDE_MODEL ?? "sonnet",
      thinkingLevel: "default",
      permissionLevel: "supervised",
    })

    const first = await service.sendMessage(chat.id, "Reply with exactly OK.")
    const second = await service.sendMessage(
      chat.id,
      "Reply with exactly AGAIN.",
    )

    expect(first.assistantMessage.contentMarkdown).toContain("OK")
    expect(second.assistantMessage.contentMarkdown).toContain("AGAIN")

    runtime.close()
  })
})
