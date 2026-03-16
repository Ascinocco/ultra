import type {
  IpcRequestEnvelope,
  QueryRequestEnvelope,
  SuccessResponseEnvelope,
} from "@ultra/shared"
import {
  artifactsCaptureRuntimeInputSchema,
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
  runtimeListGlobalComponentsInputSchema,
  sandboxesGetActiveInputSchema,
  sandboxesListInputSchema,
  sandboxesSetActiveInputSchema,
  systemGetBackendInfoQuerySchema,
  systemGetEnvironmentReadinessQuerySchema,
  systemPingQuerySchema,
  systemRecheckEnvironmentCommandSchema,
  terminalCloseSessionInputSchema,
  terminalGetRuntimeProfileInputSchema,
  terminalListSavedCommandsInputSchema,
  terminalListSessionsInputSchema,
  terminalOpenInputSchema,
  terminalPinSessionInputSchema,
  terminalRenameSessionInputSchema,
  terminalResizeSessionInputSchema,
  terminalRunSavedCommandInputSchema,
  terminalSyncRuntimeFilesInputSchema,
  terminalWriteInputInputSchema,
  threadsGetEventsInputSchema,
  threadsGetInputSchema,
  threadsListByChatInputSchema,
  threadsListByProjectInputSchema,
} from "@ultra/shared"
import type { ArtifactCaptureService } from "../artifacts/artifact-capture-service.js"
import type { ChatService } from "../chats/chat-service.js"
import type { ProjectService } from "../projects/project-service.js"
import type { WatchService } from "../runtime/watch-service.js"
import type { SandboxService } from "../sandboxes/sandbox-service.js"
import type { SystemService } from "../system/system-service.js"
import type { TerminalService } from "../terminal/terminal-service.js"
import type { TerminalSessionService } from "../terminal/terminal-session-service.js"
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
    artifactCaptureService: ArtifactCaptureService
    chatService: ChatService
    systemService: SystemService
    projectService: ProjectService
    watchService: WatchService
    sandboxService: SandboxService
    terminalService: TerminalService
    terminalSessionService: TerminalSessionService
    threadService: ThreadService
  },
): Promise<SuccessResponseEnvelope | ReturnType<typeof createErrorResponse>> {
  try {
    const request = parseEnvelopeOrThrow(raw)

    switch (request.name) {
      case "artifacts.capture_runtime": {
        const captureCommand = assertCommandRequest(request)
        return createSuccessResponse(
          captureCommand.request_id,
          services.artifactCaptureService.captureRuntime(
            artifactsCaptureRuntimeInputSchema.parse(captureCommand.payload),
          ),
        )
      }
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
      case "runtime.list_global_components": {
        const listQuery = assertQueryRequest(request)
        runtimeListGlobalComponentsInputSchema.parse(listQuery.payload)
        return createSuccessResponse(listQuery.request_id, {
          components: services.watchService.listGlobalComponents(),
        })
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
      case "terminal.get_runtime_profile": {
        const profileQuery = assertQueryRequest(request)
        return createSuccessResponse(
          profileQuery.request_id,
          services.terminalService.getRuntimeProfile(
            terminalGetRuntimeProfileInputSchema.parse(profileQuery.payload),
          ),
        )
      }
      case "terminal.list_sessions": {
        const listSessionsQuery = assertQueryRequest(request)
        return createSuccessResponse(
          listSessionsQuery.request_id,
          services.terminalSessionService.listSessions(
            terminalListSessionsInputSchema.parse(listSessionsQuery.payload),
          ),
        )
      }
      case "terminal.list_saved_commands": {
        const listSavedCommandsQuery = assertQueryRequest(request)
        return createSuccessResponse(
          listSavedCommandsQuery.request_id,
          services.terminalSessionService.listSavedCommands(
            terminalListSavedCommandsInputSchema.parse(
              listSavedCommandsQuery.payload,
            ),
          ),
        )
      }
      case "terminal.open": {
        const openTerminalCommand = assertCommandRequest(request)
        return createSuccessResponse(
          openTerminalCommand.request_id,
          services.terminalSessionService.open(
            terminalOpenInputSchema.parse(openTerminalCommand.payload),
          ),
        )
      }
      case "terminal.run_saved_command": {
        const runSavedCommand = assertCommandRequest(request)
        return createSuccessResponse(
          runSavedCommand.request_id,
          services.terminalSessionService.runSavedCommand(
            terminalRunSavedCommandInputSchema.parse(runSavedCommand.payload),
          ),
        )
      }
      case "terminal.sync_runtime_files": {
        const syncCommand = assertCommandRequest(request)
        return createSuccessResponse(
          syncCommand.request_id,
          services.terminalService.syncRuntimeFiles(
            terminalSyncRuntimeFilesInputSchema.parse(syncCommand.payload),
          ),
        )
      }
      case "terminal.write_input": {
        const writeInputCommand = assertCommandRequest(request)
        return createSuccessResponse(
          writeInputCommand.request_id,
          services.terminalSessionService.writeInput(
            terminalWriteInputInputSchema.parse(writeInputCommand.payload),
          ),
        )
      }
      case "terminal.resize_session": {
        const resizeCommand = assertCommandRequest(request)
        return createSuccessResponse(
          resizeCommand.request_id,
          services.terminalSessionService.resizeSession(
            terminalResizeSessionInputSchema.parse(resizeCommand.payload),
          ),
        )
      }
      case "terminal.close_session": {
        const closeSessionCommand = assertCommandRequest(request)
        return createSuccessResponse(
          closeSessionCommand.request_id,
          services.terminalSessionService.closeSession(
            terminalCloseSessionInputSchema.parse(closeSessionCommand.payload),
          ),
        )
      }
      case "terminal.rename_session": {
        const renameCommand = assertCommandRequest(request)
        return createSuccessResponse(
          renameCommand.request_id,
          services.terminalSessionService.renameSession(
            terminalRenameSessionInputSchema.parse(renameCommand.payload),
          ),
        )
      }
      case "terminal.pin_session": {
        const pinCommand = assertCommandRequest(request)
        return createSuccessResponse(
          pinCommand.request_id,
          services.terminalSessionService.pinSession(
            terminalPinSessionInputSchema.parse(pinCommand.payload),
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
      case "sandboxes.list": {
        const listQuery = assertQueryRequest(request)
        return createSuccessResponse(
          listQuery.request_id,
          services.sandboxService.list(
            sandboxesListInputSchema.parse(listQuery.payload).project_id,
          ),
        )
      }
      case "sandboxes.get_active": {
        const activeQuery = assertQueryRequest(request)
        return createSuccessResponse(
          activeQuery.request_id,
          services.sandboxService.getActive(
            sandboxesGetActiveInputSchema.parse(activeQuery.payload).project_id,
          ),
        )
      }
      case "sandboxes.set_active": {
        const setActiveCommand = assertCommandRequest(request)
        const { project_id, sandbox_id } = sandboxesSetActiveInputSchema.parse(
          setActiveCommand.payload,
        )
        return createSuccessResponse(
          setActiveCommand.request_id,
          services.sandboxService.setActive(project_id, sandbox_id),
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
        const listThreadsByChatQuery = assertQueryRequest(request)
        return createSuccessResponse(
          listThreadsByChatQuery.request_id,
          services.threadService.listByChat(
            threadsListByChatInputSchema.parse(listThreadsByChatQuery.payload)
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
        const getThreadEventsQuery = assertQueryRequest(request)
        const { thread_id, from_sequence } = threadsGetEventsInputSchema.parse(
          getThreadEventsQuery.payload,
        )
        return createSuccessResponse(
          getThreadEventsQuery.request_id,
          services.threadService.getEvents(thread_id, from_sequence),
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
