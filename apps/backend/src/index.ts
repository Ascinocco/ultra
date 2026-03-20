import { fileURLToPath } from "node:url"
import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"

import { ArtifactCaptureService } from "./artifacts/artifact-capture-service.js"
import { ArtifactPersistenceService } from "./artifacts/artifact-persistence-service.js"
import { ArtifactStorageService } from "./artifacts/artifact-storage-service.js"
import { ChatService } from "./chats/chat-service.js"
import { ChatTurnService } from "./chats/chat-turn-service.js"
import { ChatRuntimeRegistry } from "./chats/runtime/chat-runtime-registry.js"
import { ClaudeChatRuntimeAdapter } from "./chats/runtime/claude-chat-runtime-adapter.js"
import { CodexChatRuntimeAdapter } from "./chats/runtime/codex-chat-runtime-adapter.js"
import { SpawnRuntimeProcessRunner } from "./chats/runtime/process-runner.js"
import { ChatRuntimeSessionManager } from "./chats/runtime/runtime-session-manager.js"
import { bootstrapDatabase, type DatabaseRuntime } from "./db/database.js"
import { AgentHealthMonitor } from "./orchestration/agent-health-monitor.js"
import { AgentRegistry } from "./orchestration/agent-registry.js"
import { deployHooks } from "./orchestration/hooks-deployer.js"
import { createMergeResolver } from "./orchestration/merge-resolver.js"
import { OrchestrationService } from "./orchestration/orchestration-service.js"
import { generateOverlay } from "./orchestration/overlay-generator.js"
import {
  createWorktree,
  removeWorktree,
  rollbackWorktree,
} from "./orchestration/worktree-manager.js"
import { ProjectService } from "./projects/project-service.js"
import { CoordinatorService } from "./runtime/coordinator-service.js"
import { NodeSupervisedProcessAdapter } from "./runtime/node-supervised-process-adapter.js"
import { RuntimePersistenceService } from "./runtime/runtime-persistence-service.js"
import { RuntimeRegistry } from "./runtime/runtime-registry.js"
import { RuntimeSupervisor } from "./runtime/runtime-supervisor.js"
import type { SupervisedProcessAdapter } from "./runtime/supervised-process-adapter.js"
import { WatchService } from "./runtime/watch-service.js"
import { WatchdogService } from "./runtime/watchdog-service.js"
import { SandboxPersistenceService } from "./sandboxes/sandbox-persistence-service.js"
import { SandboxService } from "./sandboxes/sandbox-service.js"
import {
  type SocketServerRuntime,
  startSocketServer,
} from "./server/socket-server.js"
import { SystemService } from "./system/system-service.js"
import { RuntimeProfileService } from "./terminal/runtime-profile-service.js"
import { RuntimeSyncService } from "./terminal/runtime-sync-service.js"
import { TerminalCommandGenService } from "./terminal/terminal-command-gen-service.js"
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
    const watchdogService = new WatchdogService(
      runtimeSupervisor,
      runtimeRegistry,
      projectService,
      threadService,
    )
    const coordinatorService = new CoordinatorService(
      runtimeSupervisor,
      runtimeRegistry,
      projectService,
      sandboxService,
      threadService,
      undefined,
      watchdogService,
    )
    const processAdapter =
      options?.processAdapter ?? new NodeSupervisedProcessAdapter()
    const agentRegistry = new AgentRegistry()
    const agentHealthMonitor = new AgentHealthMonitor(agentRegistry, {
      staleMs: 5 * 60 * 1000,
      zombieMs: 30 * 60 * 1000,
    })
    const mergeResolver = createMergeResolver({})
    const orchestrationService = new OrchestrationService({
      processAdapter,
      threadService: {
        appendThreadEvent: (threadId, event) => {
          const thread = threadService.getThread(threadId)
          threadService.appendProjectedEvent({
            actorType: "agent",
            eventType: String(event["type"] ?? "agent_event"),
            payload: event,
            projectId: thread.thread.projectId,
            source: "ultra.orchestration",
            threadId,
          })
        },
        updateThreadSnapshot: (_threadId, _update) => {
          // No-op: OrchestrationService defines this in deps type but does not call it
        },
      },
      worktreeManager: { createWorktree, removeWorktree, rollbackWorktree },
      mergeResolver,
      hooksDeployer: { deployHooks },
      healthMonitor: agentHealthMonitor,
      agentRegistry,
      overlayGenerator: { generateOverlay },
    })
    threadService.setCoordinatorDispatchHandler({
      sendThreadMessage: (input) =>
        coordinatorService.sendThreadMessage({
          ...input,
          threadId: input.threadId,
        }),
      startThread: ({ input, thread }) => {
        const repoRoot = process.env.ULTRA_REPO_ROOT ?? process.cwd()
        const baseBranch = process.env.ULTRA_BASE_BRANCH ?? "main"
        void orchestrationService.startThread(thread.thread.id, {
          specMarkdown: input.summary ?? input.title,
          baseBranch,
          repoRoot,
        })
      },
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
    const terminalCommandGenService = new TerminalCommandGenService()
    const artifactCaptureService = new ArtifactCaptureService(
      new ArtifactStorageService(
        new ArtifactPersistenceService(databaseRuntime.database),
        databaseRuntime.databasePath,
      ),
      sandboxService,
      terminalSessionService,
    )
    const chatService = new ChatService(databaseRuntime.database)
    const chatRuntimeProcessRunner = new SpawnRuntimeProcessRunner()
    const chatTurnService = new ChatTurnService(
      chatService,
      new ChatRuntimeRegistry([
        new CodexChatRuntimeAdapter(chatRuntimeProcessRunner),
        new ClaudeChatRuntimeAdapter(chatRuntimeProcessRunner),
      ]),
      new ChatRuntimeSessionManager(),
    )
    sandboxService.setActivationSyncHandler((projectId, sandboxId) => {
      terminalService.syncRuntimeFilesForActivation(projectId, sandboxId)
    })
    socketRuntime = await startSocketServer(socketPath, {
      artifactCaptureService,
      chatService,
      chatTurnService,
      coordinatorService,
      projectService,
      runtimeRegistry,
      watchService,
      sandboxService,
      systemService: new SystemService(),
      terminalCommandGenService,
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
