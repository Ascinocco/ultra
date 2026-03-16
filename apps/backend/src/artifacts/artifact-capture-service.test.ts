import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { IpcProtocolError } from "../ipc/errors.js"
import { ProjectService } from "../projects/project-service.js"
import { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "../sandboxes/sandbox-service.js"
import { FakePtyAdapter } from "../terminal/fake-pty-adapter.js"
import { RuntimeProfileService } from "../terminal/runtime-profile-service.js"
import { RuntimeSyncService } from "../terminal/runtime-sync-service.js"
import { TerminalService } from "../terminal/terminal-service.js"
import { TerminalSessionService } from "../terminal/terminal-session-service.js"
import { ArtifactCaptureService } from "./artifact-capture-service.js"
import { ArtifactPersistenceService } from "./artifact-persistence-service.js"
import { ArtifactStorageService } from "./artifact-storage-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  firstProjectPath: string
  secondProjectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-artifact-capture-"))
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
      "2026-03-16T18:00:00Z",
      "2026-03-16T18:00:00Z",
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
      "2026-03-16T18:00:00Z",
      "2026-03-16T18:00:00Z",
    )
}

function createServices(
  databasePath: string,
  now: () => string,
  inlineThresholdBytes = 16 * 1024,
): {
  artifactCaptureService: ArtifactCaptureService
  artifactStorageService: ArtifactStorageService
  persistenceService: SandboxPersistenceService
  projectService: ProjectService
  ptyAdapter: FakePtyAdapter
  runtime: ReturnType<typeof bootstrapDatabase>
  sandboxService: SandboxService
  terminalSessionService: TerminalSessionService
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
  const artifactStorageService = new ArtifactStorageService(
    new ArtifactPersistenceService(runtime.database, now),
    databasePath,
    now,
    undefined,
    inlineThresholdBytes,
  )
  const artifactCaptureService = new ArtifactCaptureService(
    artifactStorageService,
    sandboxService,
    terminalSessionService,
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
    terminalSessionService,
    ptyAdapter,
    artifactStorageService,
    artifactCaptureService,
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

describe("ArtifactCaptureService", () => {
  it("captures a shell session into a terminal_output_bundle", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T18:05:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")

    writeFileSync(join(project.rootPath, ".env"), "API_KEY=one\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const session = services.terminalSessionService.open({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    services.ptyAdapter.sessions[0]?.emitData("hello world")

    const artifact = services.artifactCaptureService.captureRuntime({
      project_id: project.id,
      session_id: session.sessionId,
    })
    const loaded = services.artifactStorageService.loadArtifactBundle(
      artifact.artifactId,
    )

    expect(artifact.artifactType).toBe("terminal_output_bundle")
    expect(loaded?.bundle.payload).toEqual({
      command: session.commandLine,
      cwd: sandboxPath,
      exitCode: null,
      output: "hello world",
    })
    expect(artifact.metadata.source.metadata).toEqual(
      expect.objectContaining({
        sessionId: session.sessionId,
        sandboxId: threadSandbox.sandboxId,
        threadId: "thread_1",
      }),
    )

    services.runtime.close()
  })

  it("captures a saved-command session into a runtime_output_bundle", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T18:10:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")

    writeFileSync(join(project.rootPath, ".env"), "API_KEY=two\n")
    writeFileSync(
      join(project.rootPath, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.21.0",
        scripts: {
          test: "vitest run",
        },
      }),
    )
    mkdirSync(sandboxPath)
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

    services.ptyAdapter.sessions[0]?.emitData("vitest output")

    const artifact = services.artifactCaptureService.captureRuntime({
      project_id: project.id,
      session_id: session.sessionId,
    })
    const loaded = services.artifactStorageService.loadArtifactBundle(
      artifact.artifactId,
    )

    expect(artifact.artifactType).toBe("runtime_output_bundle")
    expect(loaded?.bundle.payload).toEqual({
      processType: "test",
      command: "pnpm run test",
      cwd: sandboxPath,
      exitCode: null,
      terminalOutput: "vitest output",
      debugOutput: null,
    })

    services.runtime.close()
  })

  it("captures exited sessions while they remain in registry memory", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T18:15:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")

    writeFileSync(join(project.rootPath, ".env"), "API_KEY=three\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const session = services.terminalSessionService.open({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    services.ptyAdapter.sessions[0]?.emitData("before exit")
    services.ptyAdapter.sessions[0]?.emitExit({ exitCode: 1 })

    const artifact = services.artifactCaptureService.captureRuntime({
      project_id: project.id,
      session_id: session.sessionId,
    })

    expect(artifact.metadata.source.metadata).toEqual(
      expect.objectContaining({
        status: "failed",
      }),
    )

    services.runtime.close()
  })

  it("spills large captured output and reconstructs it on load", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(
      databasePath,
      () => "2026-03-16T18:20:00Z",
      16,
    )
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")
    const output = "line output\n".repeat(8)

    writeFileSync(join(project.rootPath, ".env"), "API_KEY=four\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const session = services.terminalSessionService.open({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    services.ptyAdapter.sessions[0]?.emitData(output)

    const artifact = services.artifactCaptureService.captureRuntime({
      project_id: project.id,
      session_id: session.sessionId,
    })
    const loaded = services.artifactStorageService.loadArtifactBundle(
      artifact.artifactId,
    )

    expect(artifact.path).toBeTruthy()
    expect(artifact.metadata.largeContentRefs).toEqual([
      expect.objectContaining({
        logicalKey: "output",
      }),
    ])
    expect(loaded?.bundle.payload).toEqual({
      command: session.commandLine,
      cwd: sandboxPath,
      exitCode: null,
      output,
    })

    services.runtime.close()
  })

  it("captures empty-output sessions and does not create artifact shares", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T18:25:00Z")
    const project = services.projectService.open({ path: firstProjectPath })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")

    writeFileSync(join(project.rootPath, ".env"), "API_KEY=five\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: project.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const session = services.terminalSessionService.open({
      project_id: project.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    const artifact = services.artifactCaptureService.captureRuntime({
      project_id: project.id,
      session_id: session.sessionId,
    })
    const shareCount = services.runtime.database
      .prepare("SELECT COUNT(*) AS count FROM artifact_shares")
      .get() as { count: number }

    expect(artifact.artifactType).toBe("terminal_output_bundle")
    expect(artifact.metadata.payload.output).toBe("")
    expect(shareCount.count).toBe(0)

    services.runtime.close()
  })

  it("rejects missing and cross-project session capture", () => {
    const { databasePath, firstProjectPath, secondProjectPath } =
      createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T18:30:00Z")
    const firstProject = services.projectService.open({
      path: firstProjectPath,
    })
    const secondProject = services.projectService.open({
      path: secondProjectPath,
    })
    const sandboxPath = join(firstProjectPath, ".sandbox-thread-1")

    writeFileSync(join(firstProject.rootPath, ".env"), "API_KEY=six\n")
    mkdirSync(sandboxPath)
    seedThread(services.runtime.database, firstProject.id, "chat_1", "thread_1")
    const threadSandbox = services.persistenceService.upsertThreadSandbox({
      projectId: firstProject.id,
      threadId: "thread_1",
      path: sandboxPath,
      displayName: "Thread Sandbox",
      branchName: "thread/one",
      baseBranch: "main",
    })
    const session = services.terminalSessionService.open({
      project_id: firstProject.id,
      sandbox_id: threadSandbox.sandboxId,
    })

    expect(() =>
      services.artifactCaptureService.captureRuntime({
        project_id: firstProject.id,
        session_id: "term_missing",
      }),
    ).toThrowError(IpcProtocolError)
    expect(() =>
      services.artifactCaptureService.captureRuntime({
        project_id: secondProject.id,
        session_id: session.sessionId,
      }),
    ).toThrowError(IpcProtocolError)

    services.runtime.close()
  })

  it("rejects capture for project-scoped sessions without thread context", () => {
    const { databasePath, firstProjectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T18:35:00Z")
    const project = services.projectService.open({ path: firstProjectPath })

    writeFileSync(join(project.rootPath, ".env"), "API_KEY=seven\n")

    const session = services.terminalSessionService.open({
      project_id: project.id,
    })

    expect(() =>
      services.artifactCaptureService.captureRuntime({
        project_id: project.id,
        session_id: session.sessionId,
      }),
    ).toThrowError(IpcProtocolError)

    services.runtime.close()
  })
})
