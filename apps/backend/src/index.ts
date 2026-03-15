import { fileURLToPath } from "node:url"
import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"

import {
  type SocketServerRuntime,
  startSocketServer,
} from "./server/socket-server.js"

export function createBackendBanner(): string {
  const target = buildPlaceholderProjectLabel(APP_NAME)
  return `${APP_NAME} backend scaffold ready for ${target}`
}

export type BackendRuntime = {
  socketPath: string | null
  stop: () => Promise<void>
}

export async function startBackendScaffold(): Promise<BackendRuntime> {
  const socketPath = process.env.ULTRA_SOCKET_PATH ?? null
  let socketRuntime: SocketServerRuntime | null = null

  console.log(createBackendBanner())

  if (socketPath) {
    socketRuntime = await startSocketServer(socketPath)
  } else {
    console.log(
      "[backend] no ULTRA_SOCKET_PATH provided; socket server disabled",
    )
  }

  return {
    socketPath,
    stop: async () => {
      await socketRuntime?.close()
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

  void startBackendScaffold().then((resolvedRuntime) => {
    runtime = resolvedRuntime

    process.once("SIGINT", () => {
      void shutdown()
    })
    process.once("SIGTERM", () => {
      void shutdown()
    })
  })
}
