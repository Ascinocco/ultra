import { randomUUID } from "node:crypto"
import { unlink } from "node:fs/promises"
import { createServer, type Server } from "node:net"

import type {
  ErrorResponseEnvelope,
  IpcRequestEnvelope,
  IpcResponseEnvelope,
  SubscribeRequestEnvelope,
  SubscriptionEventEnvelope,
  SuccessResponseEnvelope,
} from "@ultra/shared"
import {
  IPC_PROTOCOL_VERSION,
  parseIpcRequestEnvelope,
  runtimeComponentUpdatedSubscribeInputSchema,
  runtimeHealthUpdatedSubscribeRequestSchema,
  runtimeProjectRuntimeUpdatedSubscribeRequestSchema,
  terminalOutputSubscribeInputSchema,
  terminalSessionsSubscribeInputSchema,
  threadsMessagesSubscribeInputSchema,
} from "@ultra/shared"

import type { ArtifactCaptureService } from "../artifacts/artifact-capture-service.js"
import type { ChatService } from "../chats/chat-service.js"
import { createErrorResponse, IpcProtocolError } from "../ipc/errors.js"
import { routeIpcRequest } from "../ipc/router.js"
import type { ProjectService } from "../projects/project-service.js"
import type { CoordinatorService } from "../runtime/coordinator-service.js"
import type { RuntimeRegistry } from "../runtime/runtime-registry.js"
import type { WatchService } from "../runtime/watch-service.js"
import type { SandboxService } from "../sandboxes/sandbox-service.js"
import { SystemService } from "../system/system-service.js"
import type { TerminalService } from "../terminal/terminal-service.js"
import type { TerminalSessionService } from "../terminal/terminal-session-service.js"
import type { ThreadService } from "../threads/thread-service.js"

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

export type SocketServerRuntime = {
  close: () => Promise<void>
  socketPath: string
}

type SocketSubscriptionRuntime = {
  cleanupBySubscriptionId: Map<string, () => void>
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
    artifactCaptureService: ArtifactCaptureService
    chatService: ChatService
    coordinatorService: CoordinatorService
    systemService?: SystemService
    projectService: ProjectService
    runtimeRegistry: RuntimeRegistry
    watchService: WatchService
    threadService: ThreadService
    sandboxService: SandboxService
    terminalSessionService: TerminalSessionService
    terminalService: TerminalService
  },
  logger: Logger = console,
): Promise<SocketServerRuntime> {
  await removeStaleSocket(socketPath)

  const systemService = services.systemService ?? new SystemService()
  const server = createServer((socket) => {
    let buffer = ""
    const subscriptionRuntime: SocketSubscriptionRuntime = {
      cleanupBySubscriptionId: new Map(),
    }

    socket.setEncoding("utf8")
    socket.on("close", () => {
      cleanupSubscriptions(subscriptionRuntime)
    })
    socket.on("error", () => {
      cleanupSubscriptions(subscriptionRuntime)
    })

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
            artifactCaptureService: services.artifactCaptureService,
            chatService: services.chatService,
            coordinatorService: services.coordinatorService,
            systemService,
            projectService: services.projectService,
            runtimeRegistry: services.runtimeRegistry,
            watchService: services.watchService,
            threadService: services.threadService,
            sandboxService: services.sandboxService,
            terminalSessionService: services.terminalSessionService,
            terminalService: services.terminalService,
          },
          socket,
          subscriptionRuntime,
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
    artifactCaptureService: ArtifactCaptureService
    chatService: ChatService
    coordinatorService: CoordinatorService
    systemService: SystemService
    projectService: ProjectService
    runtimeRegistry: RuntimeRegistry
    watchService: WatchService
    threadService: ThreadService
    sandboxService: SandboxService
    terminalSessionService: TerminalSessionService
    terminalService: TerminalService
  },
  socket: NodeJS.WritableStream,
  subscriptionRuntime: SocketSubscriptionRuntime,
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

  let request: IpcRequestEnvelope

  try {
    request = parseRequestEnvelope(raw)
  } catch (error) {
    if (error instanceof IpcProtocolError) {
      socket.write(
        `${JSON.stringify(
          createErrorResponse(
            error.requestId,
            error.code,
            error.message,
            error.details,
          ),
        )}\n`,
      )
      return
    }

    throw error
  }

  if (request.type === "subscribe") {
    try {
      const response = handleSubscribeRequest(
        request,
        services,
        socket,
        subscriptionRuntime,
      )

      socket.write(`${JSON.stringify(response.response)}\n`)

      if (response.initialEvent) {
        socket.write(`${JSON.stringify(response.initialEvent)}\n`)
      }

      logger.info(`[backend] handled request ${response.response.request_id}`)
    } catch (error) {
      if (error instanceof IpcProtocolError) {
        socket.write(
          `${JSON.stringify(
            createErrorResponse(
              error.requestId,
              error.code,
              error.message,
              error.details,
            ),
          )}\n`,
        )
        return
      }

      throw error
    }

    return
  }

  const response = (await routeIpcRequest(request, services)) as
    | IpcResponseEnvelope
    | ErrorResponseEnvelope

  socket.write(`${JSON.stringify(response)}\n`)
  logger.info(`[backend] handled request ${response.request_id}`)
}

function cleanupSubscriptions(runtime: SocketSubscriptionRuntime): void {
  for (const cleanup of runtime.cleanupBySubscriptionId.values()) {
    cleanup()
  }

  runtime.cleanupBySubscriptionId.clear()
}

function createSubscriptionEvent(
  subscriptionId: string,
  eventName: string,
  payload: unknown,
): SubscriptionEventEnvelope {
  return {
    protocol_version: IPC_PROTOCOL_VERSION,
    type: "event",
    subscription_id: subscriptionId,
    event_name: eventName,
    payload,
  }
}

function createSuccessResponse(
  requestId: string,
  result: unknown,
): SuccessResponseEnvelope {
  return {
    protocol_version: IPC_PROTOCOL_VERSION,
    request_id: requestId,
    type: "response",
    ok: true,
    result,
  }
}

function handleSubscribeRequest(
  request: SubscribeRequestEnvelope,
  services: {
    chatService: ChatService
    coordinatorService: CoordinatorService
    systemService: SystemService
    projectService: ProjectService
    runtimeRegistry: RuntimeRegistry
    watchService: WatchService
    threadService: ThreadService
    sandboxService: SandboxService
    terminalSessionService: TerminalSessionService
    terminalService: TerminalService
  },
  socket: NodeJS.WritableStream,
  subscriptionRuntime: SocketSubscriptionRuntime,
): {
  initialEvent?: SubscriptionEventEnvelope
  response: SuccessResponseEnvelope
} {
  const subscriptionId = `sub_${randomUUID()}`

  switch (request.name) {
    case "terminal.sessions": {
      const { project_id } = terminalSessionsSubscribeInputSchema.parse(
        request.payload,
      )
      const cleanup = services.terminalSessionService.subscribeToSessions(
        project_id,
        () => {
          socket.write(
            `${JSON.stringify(
              createSubscriptionEvent(subscriptionId, "terminal.sessions", {
                project_id,
                sessions: services.terminalSessionService.listSessions({
                  project_id,
                }).sessions,
              }),
            )}\n`,
          )
        },
      )

      subscriptionRuntime.cleanupBySubscriptionId.set(subscriptionId, cleanup)

      return {
        response: createSuccessResponse(request.request_id, {
          subscription_id: subscriptionId,
        }),
        initialEvent: createSubscriptionEvent(
          subscriptionId,
          "terminal.sessions",
          {
            project_id,
            sessions: services.terminalSessionService.listSessions({
              project_id,
            }).sessions,
          },
        ),
      }
    }
    case "terminal.output": {
      const { project_id, session_id } =
        terminalOutputSubscribeInputSchema.parse(request.payload)
      const cleanup = services.terminalSessionService.subscribeToOutput(
        project_id,
        session_id,
        (payload) => {
          socket.write(
            `${JSON.stringify(
              createSubscriptionEvent(
                subscriptionId,
                "terminal.output",
                payload,
              ),
            )}\n`,
          )
        },
      )

      subscriptionRuntime.cleanupBySubscriptionId.set(subscriptionId, cleanup)

      return {
        response: createSuccessResponse(request.request_id, {
          subscription_id: subscriptionId,
        }),
      }
    }
    case "runtime.component_updated": {
      runtimeComponentUpdatedSubscribeInputSchema.parse(request.payload)
      const cleanup = services.runtimeRegistry.subscribeToComponentUpdates(
        (component) => {
          socket.write(
            `${JSON.stringify(
              createSubscriptionEvent(
                subscriptionId,
                "runtime.component_updated",
                component,
              ),
            )}\n`,
          )
        },
      )

      subscriptionRuntime.cleanupBySubscriptionId.set(subscriptionId, cleanup)

      return {
        response: createSuccessResponse(request.request_id, {
          subscription_id: subscriptionId,
        }),
      }
    }
    case "runtime.project_runtime_updated": {
      const { project_id } =
        runtimeProjectRuntimeUpdatedSubscribeRequestSchema.shape.payload.parse(
          request.payload,
        )
      const cleanup = services.runtimeRegistry.subscribeToProjectRuntimeUpdates(
        project_id,
        (runtime) => {
          socket.write(
            `${JSON.stringify(
              createSubscriptionEvent(
                subscriptionId,
                "runtime.project_runtime_updated",
                runtime,
              ),
            )}\n`,
          )
        },
      )

      subscriptionRuntime.cleanupBySubscriptionId.set(subscriptionId, cleanup)

      return {
        response: createSuccessResponse(request.request_id, {
          subscription_id: subscriptionId,
        }),
      }
    }
    case "runtime.health_updated": {
      const { project_id } =
        runtimeHealthUpdatedSubscribeRequestSchema.shape.payload.parse(
          request.payload,
        )
      const cleanup = services.runtimeRegistry.subscribeToProjectHealthUpdates(
        project_id,
        (summary) => {
          socket.write(
            `${JSON.stringify(
              createSubscriptionEvent(
                subscriptionId,
                "runtime.health_updated",
                summary,
              ),
            )}\n`,
          )
        },
      )

      subscriptionRuntime.cleanupBySubscriptionId.set(subscriptionId, cleanup)

      return {
        response: createSuccessResponse(request.request_id, {
          subscription_id: subscriptionId,
        }),
      }
    }
    case "threads.messages": {
      const { thread_id } = threadsMessagesSubscribeInputSchema.parse(
        request.payload,
      )
      const cleanup = services.threadService.subscribeToMessages(
        thread_id,
        (message) => {
          socket.write(
            `${JSON.stringify(
              createSubscriptionEvent(
                subscriptionId,
                "threads.messages",
                message,
              ),
            )}\n`,
          )
        },
      )

      subscriptionRuntime.cleanupBySubscriptionId.set(subscriptionId, cleanup)

      return {
        response: createSuccessResponse(request.request_id, {
          subscription_id: subscriptionId,
        }),
      }
    }
    default:
      throw new IpcProtocolError(
        "not_found",
        `IPC subscription is not implemented: ${request.name}`,
        { requestId: request.request_id },
      )
  }
}

function parseRequestEnvelope(raw: unknown): IpcRequestEnvelope {
  if (!raw || typeof raw !== "object") {
    throw new IpcProtocolError(
      "invalid_request",
      "IPC envelope must be an object.",
    )
  }

  const candidate = raw as {
    protocol_version?: unknown
    request_id?: unknown
  }

  if (candidate.protocol_version !== IPC_PROTOCOL_VERSION) {
    throw new IpcProtocolError(
      "unsupported_protocol_version",
      `Unsupported protocol version: ${String(candidate.protocol_version ?? "unknown")}`,
      {
        requestId:
          typeof candidate.request_id === "string" &&
          candidate.request_id.length > 0
            ? candidate.request_id
            : "req_invalid",
      },
    )
  }

  try {
    return parseIpcRequestEnvelope(raw)
  } catch (error) {
    throw new IpcProtocolError(
      "invalid_request",
      "Invalid IPC request envelope.",
      {
        requestId:
          typeof candidate.request_id === "string" &&
          candidate.request_id.length > 0
            ? candidate.request_id
            : "req_invalid",
        details: error instanceof Error ? error.message : String(error),
      },
    )
  }
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
