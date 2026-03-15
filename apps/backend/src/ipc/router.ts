import type {
  IpcRequestEnvelope,
  QueryRequestEnvelope,
  SuccessResponseEnvelope,
} from "@ultra/shared"
import {
  chatsArchiveInputSchema,
  chatsCreateInputSchema,
  chatsGetInputSchema,
  chatsListInputSchema,
  chatsPinInputSchema,
  chatsPromoteWorkToThreadInputSchema,
  chatsRenameInputSchema,
  chatsRestoreInputSchema,
  chatsStartThreadInputSchema,
  chatsUnpinInputSchema,
  IPC_PROTOCOL_VERSION,
  parseEnvironmentReadinessSnapshot,
  parseIpcRequestEnvelope,
  parseProjectOpenInput,
  parseSystemHelloQuery,
  projectsGetInputSchema,
  projectsGetLayoutInputSchema,
  projectsListQuerySchema,
  projectsSetLayoutInputSchema,
  systemGetBackendInfoQuerySchema,
  systemGetEnvironmentReadinessQuerySchema,
  systemPingQuerySchema,
  systemRecheckEnvironmentCommandSchema,
  threadsGetEventsInputSchema,
  threadsGetInputSchema,
  threadsListByChatInputSchema,
  threadsListByProjectInputSchema,
} from "@ultra/shared"
import type { ChatService } from "../chats/chat-service.js"
import type { ProjectService } from "../projects/project-service.js"
import type { SystemService } from "../system/system-service.js"
import type { ThreadService } from "../threads/thread-service.js"
import { createErrorResponse, IpcProtocolError } from "./errors.js"

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

function parseEnvelopeOrThrow(raw: unknown): IpcRequestEnvelope {
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

function assertSystemQuery(request: IpcRequestEnvelope): QueryRequestEnvelope {
  if (request.type !== "query") {
    throw new IpcProtocolError(
      "invalid_request",
      `Only query requests are supported in the system namespace right now.`,
      { requestId: request.request_id },
    )
  }

  return request
}

function assertQueryRequest(request: IpcRequestEnvelope): QueryRequestEnvelope {
  if (request.type !== "query") {
    throw new IpcProtocolError(
      "invalid_request",
      `IPC method requires a query envelope: ${request.name}`,
      { requestId: request.request_id },
    )
  }

  return request
}

function assertCommandRequest(
  request: IpcRequestEnvelope,
): Extract<IpcRequestEnvelope, { type: "command" }> {
  if (request.type !== "command") {
    throw new IpcProtocolError(
      "invalid_request",
      `IPC method requires a command envelope: ${request.name}`,
      { requestId: request.request_id },
    )
  }

  return request
}

export async function routeIpcRequest(
  raw: unknown,
  services: {
    chatService: ChatService
    systemService: SystemService
    projectService: ProjectService
    threadService: ThreadService
  },
): Promise<SuccessResponseEnvelope | ReturnType<typeof createErrorResponse>> {
  try {
    const request = parseEnvelopeOrThrow(raw)

    switch (request.name) {
      case "system.hello": {
        const helloQuery = assertSystemQuery(request)
        parseSystemHelloQuery(helloQuery)
        return createSuccessResponse(
          helloQuery.request_id,
          services.systemService.hello(),
        )
      }
      case "system.get_backend_info": {
        const backendInfoQuery = assertSystemQuery(request)
        systemGetBackendInfoQuerySchema.parse(backendInfoQuery)
        return createSuccessResponse(
          backendInfoQuery.request_id,
          services.systemService.getBackendInfo(),
        )
      }
      case "system.ping": {
        const pingQuery = assertSystemQuery(request)
        systemPingQuerySchema.parse(pingQuery)
        return createSuccessResponse(
          pingQuery.request_id,
          services.systemService.ping(),
        )
      }
      case "system.get_environment_readiness": {
        const readinessQuery = assertSystemQuery(request)
        systemGetEnvironmentReadinessQuerySchema.parse(readinessQuery)
        return createSuccessResponse(
          readinessQuery.request_id,
          parseEnvironmentReadinessSnapshot(
            await services.systemService.getEnvironmentReadiness(),
          ),
        )
      }
      case "system.recheck_environment": {
        const recheckCommand = assertCommandRequest(request)
        systemRecheckEnvironmentCommandSchema.parse(recheckCommand)
        return createSuccessResponse(
          recheckCommand.request_id,
          parseEnvironmentReadinessSnapshot(
            await services.systemService.recheckEnvironment(),
          ),
        )
      }
      case "projects.open": {
        const openCommand = assertCommandRequest(request)
        return createSuccessResponse(
          openCommand.request_id,
          services.projectService.open(
            parseProjectOpenInput(openCommand.payload),
          ),
        )
      }
      case "projects.get": {
        const getQuery = assertQueryRequest(request)
        return createSuccessResponse(
          getQuery.request_id,
          services.projectService.get(
            projectsGetInputSchema.parse(getQuery.payload).project_id,
          ),
        )
      }
      case "projects.list": {
        const listQuery = assertQueryRequest(request)
        projectsListQuerySchema.parse(listQuery)
        return createSuccessResponse(
          listQuery.request_id,
          services.projectService.list(),
        )
      }
      case "chats.create": {
        const createCommand = assertCommandRequest(request)
        return createSuccessResponse(
          createCommand.request_id,
          services.chatService.create(
            chatsCreateInputSchema.parse(createCommand.payload).project_id,
          ),
        )
      }
      case "chats.list": {
        const listQuery = assertQueryRequest(request)
        return createSuccessResponse(
          listQuery.request_id,
          services.chatService.list(
            chatsListInputSchema.parse(listQuery.payload).project_id,
          ),
        )
      }
      case "chats.get": {
        const getQuery = assertQueryRequest(request)
        return createSuccessResponse(
          getQuery.request_id,
          services.chatService.get(
            chatsGetInputSchema.parse(getQuery.payload).chat_id,
          ),
        )
      }
      case "chats.rename": {
        const renameCommand = assertCommandRequest(request)
        const { chat_id, title } = chatsRenameInputSchema.parse(
          renameCommand.payload,
        )
        return createSuccessResponse(
          renameCommand.request_id,
          services.chatService.rename(chat_id, title),
        )
      }
      case "chats.pin": {
        const pinCommand = assertCommandRequest(request)
        return createSuccessResponse(
          pinCommand.request_id,
          services.chatService.pin(
            chatsPinInputSchema.parse(pinCommand.payload).chat_id,
          ),
        )
      }
      case "chats.unpin": {
        const unpinCommand = assertCommandRequest(request)
        return createSuccessResponse(
          unpinCommand.request_id,
          services.chatService.unpin(
            chatsUnpinInputSchema.parse(unpinCommand.payload).chat_id,
          ),
        )
      }
      case "chats.archive": {
        const archiveCommand = assertCommandRequest(request)
        return createSuccessResponse(
          archiveCommand.request_id,
          services.chatService.archive(
            chatsArchiveInputSchema.parse(archiveCommand.payload).chat_id,
          ),
        )
      }
      case "chats.restore": {
        const restoreCommand = assertCommandRequest(request)
        return createSuccessResponse(
          restoreCommand.request_id,
          services.chatService.restore(
            chatsRestoreInputSchema.parse(restoreCommand.payload).chat_id,
          ),
        )
      }
      case "chats.start_thread": {
        const startThreadCommand = assertCommandRequest(request)
        return createSuccessResponse(
          startThreadCommand.request_id,
          services.threadService.startThread(
            chatsStartThreadInputSchema.parse(startThreadCommand.payload),
          ),
        )
      }
      case "chats.promote_work_to_thread": {
        const promoteCommand = assertCommandRequest(request)
        return createSuccessResponse(
          promoteCommand.request_id,
          services.threadService.promoteWorkToThread(
            chatsPromoteWorkToThreadInputSchema.parse(promoteCommand.payload),
          ),
        )
      }
      case "projects.get_layout": {
        const getLayoutQuery = assertQueryRequest(request)
        const { project_id } = projectsGetLayoutInputSchema.parse(
          getLayoutQuery.payload,
        )
        return createSuccessResponse(
          getLayoutQuery.request_id,
          services.projectService.getLayout(project_id),
        )
      }
      case "projects.set_layout": {
        const setLayoutCommand = assertCommandRequest(request)
        const { project_id, layout } = projectsSetLayoutInputSchema.parse(
          setLayoutCommand.payload,
        )
        services.projectService.setLayout(project_id, layout)
        return createSuccessResponse(setLayoutCommand.request_id, null)
      }
      case "threads.list_by_project": {
        const listThreadsQuery = assertQueryRequest(request)
        return createSuccessResponse(
          listThreadsQuery.request_id,
          services.threadService.listByProject(
            threadsListByProjectInputSchema.parse(listThreadsQuery.payload)
              .project_id,
          ),
        )
      }
      case "threads.list_by_chat": {
        const listThreadsQuery = assertQueryRequest(request)
        return createSuccessResponse(
          listThreadsQuery.request_id,
          services.threadService.listByChat(
            threadsListByChatInputSchema.parse(listThreadsQuery.payload)
              .chat_id,
          ),
        )
      }
      case "threads.get": {
        const getThreadQuery = assertQueryRequest(request)
        return createSuccessResponse(
          getThreadQuery.request_id,
          services.threadService.getThread(
            threadsGetInputSchema.parse(getThreadQuery.payload).thread_id,
          ),
        )
      }
      case "threads.get_events": {
        const getEventsQuery = assertQueryRequest(request)
        const { thread_id, from_sequence } = threadsGetEventsInputSchema.parse(
          getEventsQuery.payload,
        )
        return createSuccessResponse(
          getEventsQuery.request_id,
          services.threadService.getEvents(thread_id, from_sequence ?? 0),
        )
      }
      default:
        throw new IpcProtocolError(
          "not_found",
          `IPC method is not implemented: ${request.name}`,
          { requestId: request.request_id },
        )
    }
  } catch (error) {
    if (error instanceof IpcProtocolError) {
      return createErrorResponse(
        error.requestId,
        error.code,
        error.message,
        error.details,
      )
    }

    return createErrorResponse(
      "req_internal",
      "internal_error",
      error instanceof Error ? error.message : "Unexpected IPC router failure.",
    )
  }
}
