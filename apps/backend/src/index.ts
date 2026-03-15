import { fileURLToPath } from "node:url"
import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"

import { ChatService } from "./chats/chat-service.js"
import { bootstrapDatabase, type DatabaseRuntime } from "./db/database.js"
import { ProjectService } from "./projects/project-service.js"
import {
  type SocketServerRuntime,
  startSocketServer,
} from "./server/socket-server.js"
import { SystemService } from "./system/system-service.js"

export function createBackendBanner(): string {
  const target = buildPlaceholderProjectLabel(APP_NAME)
  return `${APP_NAME} backend scaffold ready for ${target}`
}

export type BackendRuntime = {
  socketPath: string | null
  databasePath: string
  stop: () => Promise<void>
}

export async function startBackendScaffold(): Promise<BackendRuntime> {
  const socketPath = process.env.ULTRA_SOCKET_PATH ?? null
  let databaseRuntime: DatabaseRuntime | null = null
  let socketRuntime: SocketServerRuntime | null = null

  console.log(createBackendBanner())

  databaseRuntime = bootstrapDatabase()

  console.log(
    `[backend] database ready at ${databaseRuntime.databasePath} (${databaseRuntime.migrationResult.appliedMigrationIds.length} migrations applied)`,
  )

  if (socketPath) {
    socketRuntime = await startSocketServer(socketPath, {
      chatService: new ChatService(databaseRuntime.database),
      projectService: new ProjectService(databaseRuntime.database),
      systemService: new SystemService(),
    })
  } else {
    console.log(
      "[backend] no ULTRA_SOCKET_PATH provided; socket server disabled",
    )
  }

  return {
    socketPath,
    databasePath: databaseRuntime.databasePath,
    stop: async () => {
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
