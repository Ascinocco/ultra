import { z } from "zod"

export const APP_NAME = "Ultra"
export const PLACEHOLDER_PROJECT_ID = "placeholder-project"
export const IPC_PROTOCOL_VERSION = "1.0"

export const appPageValues = ["chat", "editor", "browser"] as const
export const connectionStatusValues = [
  "connecting",
  "connected",
  "degraded",
  "disconnected",
] as const
export const ipcErrorCodeValues = [
  "invalid_request",
  "unsupported_protocol_version",
  "not_found",
  "conflict",
  "invalid_state_transition",
  "permission_denied",
  "runtime_unavailable",
  "timeout",
  "internal_error",
] as const

export const appPageSchema = z.enum(appPageValues)
export const connectionStatusSchema = z.enum(connectionStatusValues)
export const ipcErrorCodeSchema = z.enum(ipcErrorCodeValues)
export const protocolVersionSchema = z.literal(IPC_PROTOCOL_VERSION)
export const requestIdSchema = z.string().min(1)
export const subscriptionIdSchema = z.string().min(1)
export const opaqueIdSchema = z.string().min(1)
export const isoUtcTimestampSchema = z.string().min(1)

export type AppPage = z.infer<typeof appPageSchema>
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>
export type IpcErrorCode = z.infer<typeof ipcErrorCodeSchema>

export function buildPlaceholderProjectLabel(projectName: string): string {
  return `${projectName} workspace`
}
