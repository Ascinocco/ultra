import { z } from "zod"

import { protocolVersionSchema } from "./constants.js"
import {
  queryRequestEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"

export const backendCapabilitiesSchema = z.object({
  supportsProjects: z.boolean(),
  supportsLayoutPersistence: z.boolean(),
  supportsSubscriptions: z.boolean(),
  supportsBackendInfo: z.boolean(),
})

export const systemHelloRequestPayloadSchema = z.object({}).strict()
export const systemGetBackendInfoRequestPayloadSchema = z.object({}).strict()
export const systemPingRequestPayloadSchema = z.object({}).strict()

export const systemHelloResultSchema = z.object({
  acceptedProtocolVersion: protocolVersionSchema,
  backendVersion: z.string().min(1),
  sessionId: z.string().min(1),
  capabilities: backendCapabilitiesSchema,
})

export const backendInfoSnapshotSchema = z.object({
  protocolVersion: protocolVersionSchema,
  backendVersion: z.string().min(1),
  sessionId: z.string().min(1),
  capabilities: backendCapabilitiesSchema,
  runtime: z.literal("node"),
  nodeVersion: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
})

export const systemPingResultSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().min(1),
})

export const systemHelloQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("system.hello"),
  payload: systemHelloRequestPayloadSchema,
})

export const systemGetBackendInfoQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("system.get_backend_info"),
    payload: systemGetBackendInfoRequestPayloadSchema,
  })

export const systemPingQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("system.ping"),
  payload: systemPingRequestPayloadSchema,
})

export const systemHelloSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: systemHelloResultSchema,
  })

export const systemGetBackendInfoSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: backendInfoSnapshotSchema,
  })

export const systemPingSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: systemPingResultSchema,
  })

export type BackendCapabilities = z.infer<typeof backendCapabilitiesSchema>
export type SystemHelloRequestPayload = z.infer<
  typeof systemHelloRequestPayloadSchema
>
export type SystemHelloResult = z.infer<typeof systemHelloResultSchema>
export type BackendInfoSnapshot = z.infer<typeof backendInfoSnapshotSchema>
export type SystemPingResult = z.infer<typeof systemPingResultSchema>
export type SystemHelloQuery = z.infer<typeof systemHelloQuerySchema>
export type SystemGetBackendInfoQuery = z.infer<
  typeof systemGetBackendInfoQuerySchema
>
export type SystemPingQuery = z.infer<typeof systemPingQuerySchema>

export function parseSystemHelloQuery(input: unknown): SystemHelloQuery {
  return systemHelloQuerySchema.parse(input)
}

export function parseSystemHelloResult(input: unknown): SystemHelloResult {
  return systemHelloResultSchema.parse(input)
}

export function parseBackendInfoSnapshot(input: unknown): BackendInfoSnapshot {
  return backendInfoSnapshotSchema.parse(input)
}

export function parseSystemPingResult(input: unknown): SystemPingResult {
  return systemPingResultSchema.parse(input)
}
