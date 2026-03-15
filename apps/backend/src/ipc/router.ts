import type {
  IpcRequestEnvelope,
  QueryRequestEnvelope,
  SuccessResponseEnvelope,
} from "@ultra/shared"
import {
  IPC_PROTOCOL_VERSION,
  parseIpcRequestEnvelope,
  parseSystemHelloQuery,
  systemGetBackendInfoQuerySchema,
  systemPingQuerySchema,
} from "@ultra/shared"
import type { SystemService } from "../system/system-service.js"
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

export async function routeIpcRequest(
  raw: unknown,
  systemService: SystemService,
): Promise<SuccessResponseEnvelope | ReturnType<typeof createErrorResponse>> {
  try {
    const request = parseEnvelopeOrThrow(raw)
    const systemQuery = assertSystemQuery(request)

    switch (systemQuery.name) {
      case "system.hello":
        parseSystemHelloQuery(systemQuery)
        return createSuccessResponse(
          systemQuery.request_id,
          systemService.hello(),
        )
      case "system.get_backend_info":
        systemGetBackendInfoQuerySchema.parse(systemQuery)
        return createSuccessResponse(
          systemQuery.request_id,
          systemService.getBackendInfo(),
        )
      case "system.ping":
        systemPingQuerySchema.parse(systemQuery)
        return createSuccessResponse(
          systemQuery.request_id,
          systemService.ping(),
        )
      default:
        throw new IpcProtocolError(
          "not_found",
          `IPC method is not implemented: ${systemQuery.name}`,
          { requestId: systemQuery.request_id },
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
