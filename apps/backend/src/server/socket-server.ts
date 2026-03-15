import { unlink } from "node:fs/promises"
import { createServer, type Server } from "node:net"

import type {
  ErrorResponseEnvelope,
  SuccessResponseEnvelope,
} from "@ultra/shared"

import type { ChatService } from "../chats/chat-service.js"
import { routeIpcRequest } from "../ipc/router.js"
import type { ProjectService } from "../projects/project-service.js"
import { SystemService } from "../system/system-service.js"
import type { ThreadService } from "../threads/thread-service.js"

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

export type SocketServerRuntime = {
  close: () => Promise<void>
  socketPath: string
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    await unlink(socketPath)
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException

    if (maybeError.code !== "ENOENT") {
      throw error
    }
  }
}

export async function startSocketServer(
  socketPath: string,
  services: {
    chatService: ChatService
    systemService?: SystemService
    projectService: ProjectService
    threadService: ThreadService
  },
  logger: Logger = console,
): Promise<SocketServerRuntime> {
  await removeStaleSocket(socketPath)

  const systemService = services.systemService ?? new SystemService()
  const server = createServer((socket) => {
    let buffer = ""

    socket.setEncoding("utf8")

    socket.on("data", (chunk) => {
      buffer += chunk

      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n")
        const rawLine = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)

        if (!rawLine) {
          continue
        }

        void handleLine(
          rawLine,
          {
            chatService: services.chatService,
            systemService,
            projectService: services.projectService,
            threadService: services.threadService,
          },
          socket,
          logger,
        )
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => {
      server.off("error", reject)
      resolve()
    })
  })

  logger.info(`[backend] listening on socket ${socketPath}`)

  return {
    socketPath,
    close: () => closeServer(server, socketPath),
  }
}

async function handleLine(
  rawLine: string,
  services: {
    chatService: ChatService
    systemService: SystemService
    projectService: ProjectService
    threadService: ThreadService
  },
  socket: NodeJS.WritableStream,
  logger: Logger,
): Promise<void> {
  let raw: unknown

  try {
    raw = JSON.parse(rawLine)
  } catch (error) {
    const malformedResponse: ErrorResponseEnvelope = {
      protocol_version: "1.0",
      request_id: "req_invalid",
      type: "response",
      ok: false,
      error: {
        code: "invalid_request",
        message: "Malformed JSON request.",
        details: error instanceof Error ? error.message : String(error),
      },
    }

    socket.write(`${JSON.stringify(malformedResponse)}\n`)
    return
  }

  const response = (await routeIpcRequest(raw, services)) as
    | SuccessResponseEnvelope
    | ErrorResponseEnvelope

  socket.write(`${JSON.stringify(response)}\n`)
  logger.info(`[backend] handled request ${response.request_id}`)
}

async function closeServer(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  await removeStaleSocket(socketPath)
}
