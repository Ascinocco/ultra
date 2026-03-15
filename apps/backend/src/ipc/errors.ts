import {
  type ErrorResponseEnvelope,
  IPC_PROTOCOL_VERSION,
  type IpcErrorCode,
} from "@ultra/shared"

export class IpcProtocolError extends Error {
  readonly code: IpcErrorCode
  readonly requestId: string
  readonly details?: unknown

  constructor(
    code: IpcErrorCode,
    message: string,
    options?: { requestId?: string; details?: unknown },
  ) {
    super(message)
    this.code = code
    this.requestId = options?.requestId ?? "req_invalid"
    this.details = options?.details
  }
}

export function createErrorResponse(
  requestId: string,
  code: IpcErrorCode,
  message: string,
  details?: unknown,
): ErrorResponseEnvelope {
  return {
    protocol_version: IPC_PROTOCOL_VERSION,
    request_id: requestId,
    type: "response",
    ok: false,
    error: {
      code,
      message,
      details,
    },
  }
}
