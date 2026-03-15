import { fileURLToPath } from "node:url"
import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"

export function createBackendBanner(): string {
  const target = buildPlaceholderProjectLabel(APP_NAME)
  return `${APP_NAME} backend scaffold ready for ${target}`
}

export type BackendRuntime = {
  socketPath: string | null
  stop: () => void
}

export function startBackendScaffold(): BackendRuntime {
  const socketPath = process.env.ULTRA_SOCKET_PATH ?? null
  const keepAlive = setInterval(() => undefined, 60_000)

  console.log(createBackendBanner())

  if (socketPath) {
    console.log(`[backend] socket path reserved at ${socketPath}`)
  }

  return {
    socketPath,
    stop: () => {
      clearInterval(keepAlive)
    },
  }
}

const entryPath = process.argv[1]
const currentPath = fileURLToPath(import.meta.url)

if (entryPath && currentPath === entryPath) {
  const runtime = startBackendScaffold()

  const shutdown = () => {
    runtime.stop()
    process.exit(0)
  }

  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}
