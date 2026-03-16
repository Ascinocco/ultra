import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "../sandboxes/sandbox-service.js"
import { FakePtyAdapter } from "./fake-pty-adapter.js"
import { RuntimeProfileService } from "./runtime-profile-service.js"
import { RuntimeSyncService } from "./runtime-sync-service.js"
import { TerminalService } from "./terminal-service.js"
import { TerminalSessionService } from "./terminal-session-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  firstProjectPath: string
  secondProjectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-terminal-session-"))
  const firstProjectPath = join(directory, "project-one")
  const secondProjectPath = join(directory, "project-two")
  temporaryDirectories.push(directory)
  mkdirSync(firstProjectPath)
  mkdirSync(secondProjectPath)

  return {
    databasePath: join(directory, "ultra.db"),
    firstProjectPath,
    secondProjectPath,
  }
}

function seedThread(
  database: ReturnType<typeof bootstrapDatabase>["database"],
  projectId: string,
  chatId: string,
  threadId: string,
): void {
  database
    .prepare(
      "INSERT INTO chats (id, project_id, title, status, provider, model, thinking_level, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      chatId,
      projectId,
      `Chat ${chatId}`,
      "active",
      "codex",
      "gpt-5-codex",
      "standard",
      "supervised",
      "2026-03-15T21:00:00Z",
      "2026-03-15T21:00:00Z",
    )

  database
    .prepare(
      "INSERT INTO threads (id, project_id, source_chat_id, title, execution_state, review_state, publish_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      threadId,
      projectId,
      chatId,
      `Thread ${threadId}`,
      "queued",
      "not_ready",
      "not_requested",
      "2026-03-15T21:00:00Z",
      "2026-03-15T21:00:00Z",
    )
}

function createServices(
  databasePath: string,
  now: () => string,
): {
  persistenceService: SandboxPersistenceService
  projectService: ProjectService
  ptyAdapter: FakePtyAdapter
  runtime: ReturnType<typeof bootstrapDatabase>
  sandboxService: SandboxService
  terminalSessionService: TerminalSessionService
  terminalService: TerminalService
} {
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const persistenceService = new SandboxPersistenceService(
    runtime.database,
    now,
  )
  const sandboxService = new SandboxService(persistenceService)
  const runtimeProfileService = new RuntimeProfileService(
    runtime.database,
    persistenceService,
  )
  const terminalService = new TerminalService(
    sandboxService,
    runtimeProfileService,
    new RuntimeSyncService(persistenceService, now),
  )
  const ptyAdapter = new FakePtyAdapter()
  const terminalSessionService = new TerminalSessionService(
    terminalService,
    runtimeProfileService,
    ptyAdapter,
    undefined,
    now,
  )

  sandboxService.setActivationSyncHandler((projectId, sandboxId) => {
    terminalService.syncRuntimeFilesForActivation(projectId, sandboxId)
  })

  return {
    runtime,
    projectService: new ProjectService(runtime.database),
    persistenceService,
    sandboxService,
    terminalService,
    terminalSessionService,
    ptyAdapter,
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

describe("TerminalSessionService", () => {
  it("opens a PTY in the active sandbox and reuses the shell session", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T21:05:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=one\n")

    const first = services.terminalSessionService.open({
      project_id: project.id,
    })
    const second = services.terminalSessionService.open({
      project_id: project.id,
    })

    expect(first.cwd).toBe(project.rootPath)
    expect(first.sessionId).toBe(second.sessionId)
    expect(services.ptyAdapter.sessions).toHaveLength(1)

    services.runtime.close()
  })

  it("launches saved commands in a thread sandbox and syncs runtime files first", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T21:10:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")
    mkdirSync(sandboxPath)
    writeFileSync(
      join(project.rootPath, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.21.0",
        scripts: {
          test: "vitest run",
        },
      }),
    )
    writeFileSync(join(project.rootPath, ".env"), "API_KEY=two\n")
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })

    const session = services.terminalSessionService.runSavedCommand({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
      command_id: "test",
    })

    expect(session.sessionKind).toBe("saved_command")
    expect(session.commandLine).toBe("pnpm run test")
    expect(services.ptyAdapter.sessions[0]?.options.cwd).toBe(sandboxPath)
    expect(readFileSync(join(sandboxPath, ".env"), "utf8")).toBe(
      "API_KEY=two\n",
    )

    services.runtime.close()
  })

  it("lists saved commands from project scripts and marks missing ones unavailable", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T21:15:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    writeFileSync(
      join(project.rootPath, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "biome check .",
        },
      }),
    )

    const result = services.terminalSessionService.listSavedCommands({
      project_id: project.id,
    })

    expect(
      result.commands.find((command) => command.commandId === "lint"),
    ).toEqual(
      expect.objectContaining({
        isAvailable: true,
        commandLine: "npm run lint",
      }),
    )
    expect(
      result.commands.find((command) => command.commandId === "test"),
    ).toEqual(
      expect.objectContaining({
        isAvailable: false,
      }),
    )

    services.runtime.close()
  })

  it("rejects launching an unavailable saved command", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T21:20:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    writeFileSync(join(project.rootPath, "package.json"), JSON.stringify({}))

    expect(() =>
      services.terminalSessionService.runSavedCommand({
        project_id: project.id,
        command_id: "test",
      }),
    ).toThrow(/Saved command|Missing "test" script/)

    services.runtime.close()
  })

  it("forwards write input and resize updates to the live PTY", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T21:25:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    const session = services.terminalSessionService.open({
      project_id: project.id,
    })

    services.terminalSessionService.writeInput({
      project_id: project.id,
      session_id: session.sessionId,
      input: "pnpm test\n",
    })
    services.terminalSessionService.resizeSession({
      project_id: project.id,
      session_id: session.sessionId,
      cols: 140,
      rows: 42,
    })

    expect(services.ptyAdapter.sessions[0]?.writes).toEqual(["pnpm test\n"])
    expect(services.ptyAdapter.sessions[0]?.resizeCalls).toEqual([
      { cols: 140, rows: 42 },
    ])

    services.runtime.close()
  })

  it("updates session state on close and buffers recent output", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-15T21:30:0${tick}Z`
    }
    const services = createServices(databasePath, now)
    const project = services.projectService.open({ path: firstProjectPath })
    const outputEvents: string[] = []
    const session = services.terminalSessionService.open({
      project_id: project.id,
    })
    const unsubscribe = services.terminalSessionService.subscribeToOutput(
      project.id,
      session.sessionId,
      (payload) => {
        outputEvents.push(`${payload.sequence_number}:${payload.chunk}`)
      },
    )

    services.ptyAdapter.sessions[0]?.emitData("hello")
    services.ptyAdapter.sessions[0]?.emitData(" world")
    services.terminalSessionService.closeSession({
      project_id: project.id,
      session_id: session.sessionId,
    })
    unsubscribe()

    const listed = services.terminalSessionService.listSessions({
      project_id: project.id,
    }).sessions[0]

    expect(outputEvents).toEqual(["1:hello", "2: world"])
    expect(listed?.recentOutput).toBe("hello world")
    expect(listed?.status).toBe("exited")
    expect(listed?.exitCode).toBe(0)

    services.runtime.close()
  })

  it("rejects cross-project session access with not_found behavior", () => {
    const { databasePath, firstProjectPath, secondProjectPath } =
      createWorkspace()
    const services = createServices(databasePath, () => "2026-03-15T21:35:00Z")
    const firstProject = services.projectService.open({
      path: firstProjectPath,
    })
    const secondProject = services.projectService.open({
      path: secondProjectPath,
    })
    const session = services.terminalSessionService.open({
      project_id: firstProject.id,
    })

    expect(() =>
      services.terminalSessionService.writeInput({
        project_id: secondProject.id,
        session_id: session.sessionId,
        input: "pwd\n",
      }),
    ).toThrow(/Terminal session/)

    services.runtime.close()
  })
})
