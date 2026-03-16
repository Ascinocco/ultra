import { fileURLToPath } from "node:url"
import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"

import { ArtifactCaptureService } from "./artifacts/artifact-capture-service.js"
import { ArtifactPersistenceService } from "./artifacts/artifact-persistence-service.js"
import { ArtifactStorageService } from "./artifacts/artifact-storage-service.js"
import { ChatService } from "./chats/chat-service.js"
import { bootstrapDatabase, type DatabaseRuntime } from "./db/database.js"
import { ProjectService } from "./projects/project-service.js"
import { CoordinatorService } from "./runtime/coordinator-service.js"
import { NodeSupervisedProcessAdapter } from "./runtime/node-supervised-process-adapter.js"
import { RuntimePersistenceService } from "./runtime/runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime/runtime-registry.js"
import { RuntimeSupervisor } from "./runtime/runtime-supervisor.js"
import type { SupervisedProcessAdapter } from "./runtime/supervised-process-adapter.js"
import { WatchService } from "./runtime/watch-service.js"
import { SandboxPersistenceService } from "./sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "./sandboxes/sandbox-service.js"
import {
  type SocketServerRuntime,
  startSocketServer,
} from "./server/socket-server.js"
import { SystemService } from "./system/system-service.js"
import { RuntimeProfileService } from "./terminal/runtime-profile-service.js"
import { RuntimeSyncService } from "./terminal/runtime-sync-service.js"
import { TerminalService } from "./terminal/terminal-service.js"
import { TerminalSessionService } from "./terminal/terminal-session-service.js"
import { ThreadService } from "./threads/thread-service.js"

export function createBackendBanner(): string {
  const target = buildPlaceholderProjectLabel(APP_NAME)
  return `${APP_NAME} backend scaffold ready for ${target}`
}

export type BackendRuntime = {
  socketPath: string | null
  databasePath: string
  runtimeRegistry: RuntimeRegistry
  runtimeSupervisor: RuntimeSupervisor
  stop: () => Promise<void>
}

export async function startBackendScaffold(options?: {
  processAdapter?: SupervisedProcessAdapter
}): Promise<BackendRuntime> {
  const socketPath = process.env.ULTRA_SOCKET_PATH ?? null
  let databaseRuntime: DatabaseRuntime | null = null
  let socketRuntime: SocketServerRuntime | null = null
  let terminalSessionService: TerminalSessionService | null = null

  console.log(createBackendBanner())

  databaseRuntime = bootstrapDatabase()
  const runtimePersistenceService = new RuntimePersistenceService(
    databaseRuntime.database,
  )
  const runtimeRegistry = new RuntimeRegistry(runtimePersistenceService)
  const runtimeSupervisor = new RuntimeSupervisor(
    runtimeRegistry,
    options?.processAdapter ?? new NodeSupervisedProcessAdapter(),
  )
  const watchService = new WatchService(
    runtimeSupervisor,
    runtimeRegistry,
    databaseRuntime.databasePath,
  )

  runtimeSupervisor.hydrate()
  watchService.ensureRunning()

  console.log(
    `[backend] database ready at ${databaseRuntime.databasePath} (${databaseRuntime.migrationResult.appliedMigrationIds.length} migrations applied)`,
  )

  if (socketPath) {
    const projectService = new ProjectService(databaseRuntime.database)
    const threadService = new ThreadService(databaseRuntime.database)
    const sandboxPersistenceService = new SandboxPersistenceService(
      databaseRuntime.database,
    )
    const sandboxService = new SandboxService(sandboxPersistenceService)
    const coordinatorService = new CoordinatorService(
      runtimeSupervisor,
      runtimeRegistry,
      projectService,
      sandboxService,
      threadService,
    )
    threadService.setCoordinatorDispatchHandler({
      sendThreadMessage: (input) =>
        coordinatorService.sendThreadMessage({
          ...input,
          threadId: input.threadId,
        }),
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
    terminalSessionService = new TerminalSessionService(
      terminalService,
      runtimeProfileService,
    )
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
    socketRuntime = await startSocketServer(socketPath, {
      artifactCaptureService,
      chatService: new ChatService(databaseRuntime.database),
      coordinatorService,
      projectService,
      runtimeRegistry,
      watchService,
      sandboxService,
      systemService: new SystemService(),
      terminalSessionService,
      terminalService,
      threadService,
    })
  } else {
    console.log(
      "[backend] no ULTRA_SOCKET_PATH provided; socket server disabled",
    )
  }

  return {
    socketPath,
    databasePath: databaseRuntime.databasePath,
    runtimeRegistry,
    runtimeSupervisor,
    stop: async () => {
      runtimeSupervisor.dispose()
      terminalSessionService?.dispose()
      await socketRuntime?.close()
      databaseRuntime?.close()
    },
  }
}

const entryPath = process.argv[1]
const currentPath = fileURLToPath(import.meta.url)

if (entryPath && currentPath === entryPath) {
  let runtime: BackendRuntime | null = null

  const shutdown = async () => {
    await runtime?.stop()
    process.exit(0)
  }

  void startBackendScaffold()
    .then((resolvedRuntime) => {
      runtime = resolvedRuntime

      process.once("SIGINT", () => {
        void shutdown()
      })
      process.once("SIGTERM", () => {
        void shutdown()
      })
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)

      console.error(`[backend] failed to start: ${message}`)
      process.exit(1)
    })
}
