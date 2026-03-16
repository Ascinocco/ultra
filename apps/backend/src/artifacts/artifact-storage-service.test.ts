import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { ArtifactPersistenceService } from "./artifact-persistence-service.js"
import {
  ArtifactStorageService,
  deriveArtifactStorageRoot,
} from "./artifact-storage-service.js"

const temporaryDirectories: string[] = []

function createWorkspace(): {
  databasePath: string
  projectPath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "ultra-artifact-storage-"))
  const projectPath = join(directory, "project-one")
  temporaryDirectories.push(directory)
  mkdirSync(projectPath)

  return {
    databasePath: join(directory, "ultra.db"),
    projectPath,
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
      "2026-03-16T10:00:00Z",
      "2026-03-16T10:00:00Z",
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
      "2026-03-16T10:00:00Z",
      "2026-03-16T10:00:00Z",
    )
}

function createServices(databasePath: string, now: () => string) {
  const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
  const persistence = new ArtifactPersistenceService(runtime.database, now)
  const storage = new ArtifactStorageService(
    persistence,
    databasePath,
    now,
    undefined,
    32,
  )

  return {
    runtime,
    persistence,
    storage,
    projectService: new ProjectService(runtime.database),
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

describe("ArtifactStorageService", () => {
  it("stores a small artifact inline without writing spill files", () => {
    const { databasePath, projectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T10:05:00Z")
    const project = services.projectService.open({ path: projectPath })
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")

    const artifact = services.storage.storeArtifact({
      projectId: project.id,
      threadId: "thread_1",
      bundle: {
        artifactType: "runtime_output_bundle",
        title: "Runtime failure",
        summary: "Small runtime bundle",
        capturedAt: "2026-03-16T10:04:00Z",
        source: {
          surface: "runtime",
          metadata: {
            sessionId: "term_1",
          },
        },
        payload: {
          processType: "test",
          command: "pnpm test",
          cwd: project.rootPath,
          exitCode: 1,
          terminalOutput: "short output",
          debugOutput: "debug",
        },
      },
    })

    expect(artifact.path).toBeNull()
    expect(artifact.metadata.largeContentRefs).toEqual([])
    expect(
      services.storage.loadArtifactBundle(artifact.artifactId)?.bundle,
    ).toEqual(
      expect.objectContaining({
        artifactType: "runtime_output_bundle",
      }),
    )
    expect(existsSync(deriveArtifactStorageRoot(databasePath))).toBe(false)

    services.runtime.close()
  })

  it("spills oversized payload sections to disk and reconstructs the bundle on load", () => {
    const { databasePath, projectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T10:10:00Z")
    const project = services.projectService.open({ path: projectPath })
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    const output = "terminal line\n".repeat(10)

    const artifact = services.storage.storeArtifact({
      projectId: project.id,
      threadId: "thread_1",
      bundle: {
        artifactType: "terminal_output_bundle",
        title: "Terminal transcript",
        summary: "Large terminal output",
        capturedAt: "2026-03-16T10:09:00Z",
        source: {
          surface: "terminal",
          metadata: {
            sessionId: "term_1",
          },
        },
        payload: {
          command: "pnpm test",
          cwd: project.rootPath,
          exitCode: 1,
          output,
        },
      },
    })

    expect(artifact.path).toBeTruthy()
    expect(artifact.metadata.largeContentRefs).toEqual([
      expect.objectContaining({
        logicalKey: "output",
      }),
    ])

    const ref = artifact.metadata.largeContentRefs[0]
    const artifactPath = artifact.path

    expect(ref).toBeDefined()
    expect(artifactPath).toBeTruthy()

    if (!ref || !artifactPath) {
      throw new Error("Expected spilled artifact references to be present.")
    }

    const spillPath = join(
      deriveArtifactStorageRoot(databasePath),
      artifactPath,
      ref.relativePath,
    )

    expect(readFileSync(spillPath, "utf8")).toBe(output)
    expect(artifact.metadata.payload.output).toBeNull()

    const loaded = services.storage.loadArtifactBundle(artifact.artifactId)

    expect(loaded?.bundle.payload).toEqual({
      command: "pnpm test",
      cwd: project.rootPath,
      exitCode: 1,
      output,
    })

    services.runtime.close()
  })

  it("lists artifacts for a thread in reverse-created order", () => {
    const { databasePath, projectPath } = createWorkspace()
    let tick = 0
    const now = () => {
      tick += 1
      return `2026-03-16T10:15:0${tick}Z`
    }
    const services = createServices(databasePath, now)
    const project = services.projectService.open({ path: projectPath })
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")

    const first = services.storage.storeArtifact({
      projectId: project.id,
      threadId: "thread_1",
      bundle: {
        artifactType: "runtime_output_bundle",
        title: "First",
        summary: "First summary",
        capturedAt: "2026-03-16T10:14:00Z",
        source: { surface: "runtime", metadata: {} },
        payload: {
          processType: "test",
          command: "pnpm test",
          cwd: project.rootPath,
          exitCode: 1,
          terminalOutput: "one",
          debugOutput: null,
        },
      },
    })
    const second = services.storage.storeArtifact({
      projectId: project.id,
      threadId: "thread_1",
      bundle: {
        artifactType: "runtime_output_bundle",
        title: "Second",
        summary: "Second summary",
        capturedAt: "2026-03-16T10:14:30Z",
        source: { surface: "runtime", metadata: {} },
        payload: {
          processType: "test",
          command: "pnpm test",
          cwd: project.rootPath,
          exitCode: 1,
          terminalOutput: "two",
          debugOutput: null,
        },
      },
    })

    expect(services.storage.listArtifactsForThread("thread_1")).toEqual([
      expect.objectContaining({ artifactId: second.artifactId }),
      expect.objectContaining({ artifactId: first.artifactId }),
    ])

    services.runtime.close()
  })

  it("cleans up staged files when persistence fails after spilling content", () => {
    const { databasePath, projectPath } = createWorkspace()
    const now = () => "2026-03-16T10:20:00Z"
    const runtime = bootstrapDatabase({ ULTRA_DB_PATH: databasePath })
    const projectService = new ProjectService(runtime.database)
    const project = projectService.open({ path: projectPath })
    seedThread(runtime.database, project.id, "chat_1", "thread_1")
    const fixedId = "artifact_duplicate"
    const persistence = new ArtifactPersistenceService(
      runtime.database,
      now,
      () => fixedId,
    )
    const storage = new ArtifactStorageService(
      persistence,
      databasePath,
      now,
      () => fixedId,
      16,
    )
    const bundle = {
      artifactType: "terminal_output_bundle" as const,
      title: "Transcript",
      summary: "Large output",
      capturedAt: "2026-03-16T10:19:00Z",
      source: { surface: "terminal" as const, metadata: {} },
      payload: {
        command: "pnpm test",
        cwd: project.rootPath,
        exitCode: 1,
        output: "output line\n".repeat(8),
      },
    }

    storage.storeArtifact({
      projectId: project.id,
      threadId: "thread_1",
      bundle,
    })

    expect(() =>
      storage.storeArtifact({
        projectId: project.id,
        threadId: "thread_1",
        bundle,
      }),
    ).toThrow()

    const spillDirectory = join(
      deriveArtifactStorageRoot(databasePath),
      project.id,
      "thread_1",
      fixedId,
    )

    expect(existsSync(spillDirectory)).toBe(true)
    expect(
      readdirSync(
        join(deriveArtifactStorageRoot(databasePath), project.id, "thread_1"),
      ),
    ).toEqual([fixedId])

    runtime.close()
  })

  it("surfaces missing spilled content with a structured storage error", () => {
    const { databasePath, projectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T10:25:00Z")
    const project = services.projectService.open({ path: projectPath })
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")

    const artifact = services.storage.storeArtifact({
      projectId: project.id,
      threadId: "thread_1",
      bundle: {
        artifactType: "terminal_output_bundle",
        title: "Transcript",
        summary: "Large output",
        capturedAt: "2026-03-16T10:24:00Z",
        source: { surface: "terminal", metadata: {} },
        payload: {
          command: "pnpm test",
          cwd: project.rootPath,
          exitCode: 1,
          output: "output line\n".repeat(8),
        },
      },
    })
    const ref = artifact.metadata.largeContentRefs[0]
    const artifactPath = artifact.path

    expect(ref).toBeDefined()
    expect(artifactPath).toBeTruthy()

    if (!ref || !artifactPath) {
      throw new Error("Expected spilled artifact references to be present.")
    }

    const spillPath = join(
      deriveArtifactStorageRoot(databasePath),
      artifactPath,
      ref.relativePath,
    )
    unlinkSync(spillPath)

    try {
      services.storage.loadArtifactBundle(artifact.artifactId)
      throw new Error(
        "Expected loadArtifactBundle to throw for missing spill content.",
      )
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        name: "ArtifactStorageError",
        code: "missing_spilled_content",
      })
    }

    services.runtime.close()
  })

  it("derives the artifact storage root from the database directory instead of the project root", () => {
    const { databasePath, projectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T10:30:00Z")
    const project = services.projectService.open({ path: projectPath })
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")

    const artifact = services.storage.storeArtifact({
      projectId: project.id,
      threadId: "thread_1",
      bundle: {
        artifactType: "terminal_output_bundle",
        title: "Transcript",
        summary: "Large output",
        capturedAt: "2026-03-16T10:29:00Z",
        source: { surface: "terminal", metadata: {} },
        payload: {
          command: "pnpm test",
          cwd: project.rootPath,
          exitCode: 1,
          output: "output line\n".repeat(8),
        },
      },
    })

    const spillRoot = deriveArtifactStorageRoot(databasePath)

    expect(artifact.path).toBeTruthy()
    expect(artifact.path?.startsWith(project.rootPath)).toBe(false)
    expect(artifact.path).toBeTruthy()

    if (!artifact.path) {
      throw new Error("Expected spilled artifact path to be present.")
    }

    expect(existsSync(join(spillRoot, artifact.path))).toBe(true)
    expect(existsSync(join(project.rootPath, "artifacts"))).toBe(false)

    services.runtime.close()
  })

  it("leaves no committed row behind when spilling cannot create its storage root", () => {
    const { databasePath, projectPath } = createWorkspace()
    const services = createServices(databasePath, () => "2026-03-16T10:35:00Z")
    const project = services.projectService.open({ path: projectPath })
    seedThread(services.runtime.database, project.id, "chat_1", "thread_1")
    writeFileSync(deriveArtifactStorageRoot(databasePath), "blocked")

    expect(() =>
      services.storage.storeArtifact({
        projectId: project.id,
        threadId: "thread_1",
        bundle: {
          artifactType: "terminal_output_bundle",
          title: "Transcript",
          summary: "Large output",
          capturedAt: "2026-03-16T10:34:00Z",
          source: { surface: "terminal", metadata: {} },
          payload: {
            command: "pnpm test",
            cwd: project.rootPath,
            exitCode: 1,
            output: "output line\n".repeat(8),
          },
        },
      }),
    ).toThrow()

    expect(services.storage.listArtifactsForThread("thread_1")).toEqual([])

    services.runtime.close()
  })
})
