import { z } from "zod"

import { protocolVersionSchema } from "./constants.js"
import {
  commandRequestEnvelopeSchema,
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
export const systemGetEnvironmentReadinessRequestPayloadSchema = z
  .object({})
  .strict()
export const systemPingRequestPayloadSchema = z.object({}).strict()
export const systemRecheckEnvironmentRequestPayloadSchema = z
  .object({})
  .strict()

export const dependencyToolValues = [
  "git",
  "ov",
  "tmux",
  "sd",
  "codex",
  "claude",
  "node",
  "pnpm",
] as const
export const dependencyScopeValues = [
  "runtime-required",
  "developer-required",
] as const
export const dependencyStatusValues = [
  "ready",
  "missing",
  "unsupported",
  "error",
  "skipped",
] as const
export const environmentReadinessStatusValues = ["ready", "blocked"] as const
export const environmentSessionModeValues = ["desktop", "development"] as const

export const dependencyToolSchema = z.enum(dependencyToolValues)
export const dependencyScopeSchema = z.enum(dependencyScopeValues)
export const dependencyStatusSchema = z.enum(dependencyStatusValues)
export const environmentReadinessStatusSchema = z.enum(
  environmentReadinessStatusValues,
)
export const environmentSessionModeSchema = z.enum(environmentSessionModeValues)

export const dependencyCheckSchema = z.object({
  tool: dependencyToolSchema,
  displayName: z.string().min(1),
  scope: dependencyScopeSchema,
  requiredInCurrentSession: z.boolean(),
  status: dependencyStatusSchema,
  detectedVersion: z.string().min(1).nullable(),
  command: z.string().min(1),
  helpText: z.string().min(1),
})

export const environmentReadinessSnapshotSchema = z.object({
  status: environmentReadinessStatusSchema,
  sessionMode: environmentSessionModeSchema,
  checkedAt: z.string().min(1),
  checks: z.array(dependencyCheckSchema),
})

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

export const systemGetEnvironmentReadinessQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("system.get_environment_readiness"),
    payload: systemGetEnvironmentReadinessRequestPayloadSchema,
  })

export const systemPingQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("system.ping"),
  payload: systemPingRequestPayloadSchema,
})

export const systemRecheckEnvironmentCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("system.recheck_environment"),
    payload: systemRecheckEnvironmentRequestPayloadSchema,
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

export const systemGetEnvironmentReadinessSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: environmentReadinessSnapshotSchema,
  })

export const systemRecheckEnvironmentSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: environmentReadinessSnapshotSchema,
  })

export type BackendCapabilities = z.infer<typeof backendCapabilitiesSchema>
export type DependencyTool = z.infer<typeof dependencyToolSchema>
export type DependencyScope = z.infer<typeof dependencyScopeSchema>
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>
export type EnvironmentReadinessStatus = z.infer<
  typeof environmentReadinessStatusSchema
>
export type EnvironmentSessionMode = z.infer<
  typeof environmentSessionModeSchema
>
export type EnvironmentReadinessSnapshot = z.infer<
  typeof environmentReadinessSnapshotSchema
>
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
export type SystemGetEnvironmentReadinessQuery = z.infer<
  typeof systemGetEnvironmentReadinessQuerySchema
>
export type SystemPingQuery = z.infer<typeof systemPingQuerySchema>
export type SystemRecheckEnvironmentCommand = z.infer<
  typeof systemRecheckEnvironmentCommandSchema
>

export function parseSystemHelloQuery(input: unknown): SystemHelloQuery {
  return systemHelloQuerySchema.parse(input)
}

export function parseSystemHelloResult(input: unknown): SystemHelloResult {
  return systemHelloResultSchema.parse(input)
}

export function parseBackendInfoSnapshot(input: unknown): BackendInfoSnapshot {
  return backendInfoSnapshotSchema.parse(input)
}

export function parseEnvironmentReadinessSnapshot(
  input: unknown,
): EnvironmentReadinessSnapshot {
  return environmentReadinessSnapshotSchema.parse(input)
}

export function parseSystemPingResult(input: unknown): SystemPingResult {
  return systemPingResultSchema.parse(input)
}
