import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import {
  queryRequestEnvelopeSchema,
  subscribeRequestEnvelopeSchema,
  subscriptionEventEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"
import { projectIdSchema } from "./projects.js"

export const runtimeComponentScopeSchema = z.enum(["project", "global"])
export const runtimeComponentHealthStatusSchema = z.enum([
  "healthy",
  "degraded",
  "down",
])
export const runtimeComponentTypeSchema = z.enum([
  "coordinator",
  "watchdog",
  "ov_watch",
])
export const runtimeDetailsSchema = z.record(z.string(), z.unknown())

export const runtimeComponentSnapshotSchema = z.object({
  componentId: opaqueIdSchema,
  projectId: projectIdSchema.nullable(),
  componentType: runtimeComponentTypeSchema,
  scope: runtimeComponentScopeSchema,
  processId: z.number().int().nullable(),
  status: runtimeComponentHealthStatusSchema,
  startedAt: isoUtcTimestampSchema.nullable(),
  lastHeartbeatAt: isoUtcTimestampSchema.nullable(),
  restartCount: z.number().int().min(0),
  reason: z.string().nullable(),
  details: runtimeDetailsSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
})

export const projectRuntimeSnapshotSchema = z.object({
  projectRuntimeId: opaqueIdSchema,
  projectId: projectIdSchema,
  coordinatorId: opaqueIdSchema.nullable(),
  coordinatorInstanceId: opaqueIdSchema.nullable(),
  status: z.string().min(1),
  startedAt: isoUtcTimestampSchema.nullable(),
  lastHeartbeatAt: isoUtcTimestampSchema.nullable(),
  restartCount: z.number().int().min(0),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
})

export const runtimeHealthCheckSnapshotSchema = z.object({
  healthCheckId: opaqueIdSchema,
  componentId: opaqueIdSchema,
  projectId: projectIdSchema.nullable(),
  status: runtimeComponentHealthStatusSchema,
  checkedAt: isoUtcTimestampSchema,
  lastHeartbeatAt: isoUtcTimestampSchema.nullable(),
  reason: z.string().nullable(),
  details: runtimeDetailsSchema.nullable(),
})

export const projectRuntimeHealthSummarySchema = z.object({
  projectId: projectIdSchema,
  status: runtimeComponentHealthStatusSchema,
  latestReason: z.string().nullable(),
  components: z.array(runtimeComponentSnapshotSchema),
})

export const runtimeListGlobalComponentsInputSchema = z.object({}).strict()
export const runtimeComponentUpdatedSubscribeInputSchema = z.object({}).strict()

export const runtimeListGlobalComponentsResultSchema = z.object({
  components: z.array(runtimeComponentSnapshotSchema),
})

export const runtimeListGlobalComponentsQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("runtime.list_global_components"),
    payload: runtimeListGlobalComponentsInputSchema,
  })

export const runtimeListGlobalComponentsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: runtimeListGlobalComponentsResultSchema,
  })

export const runtimeComponentUpdatedSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("runtime.component_updated"),
    payload: runtimeComponentUpdatedSubscribeInputSchema,
  })

export const runtimeComponentUpdatedEventSchema =
  subscriptionEventEnvelopeSchema.extend({
    event_name: z.literal("runtime.component_updated"),
    payload: runtimeComponentSnapshotSchema,
  })

export type RuntimeComponentScope = z.infer<typeof runtimeComponentScopeSchema>
export type RuntimeComponentHealthStatus = z.infer<
  typeof runtimeComponentHealthStatusSchema
>
export type RuntimeComponentType = z.infer<typeof runtimeComponentTypeSchema>
export type RuntimeDetails = z.infer<typeof runtimeDetailsSchema>
export type RuntimeComponentSnapshot = z.infer<
  typeof runtimeComponentSnapshotSchema
>
export type ProjectRuntimeSnapshot = z.infer<
  typeof projectRuntimeSnapshotSchema
>
export type RuntimeHealthCheckSnapshot = z.infer<
  typeof runtimeHealthCheckSnapshotSchema
>
export type ProjectRuntimeHealthSummary = z.infer<
  typeof projectRuntimeHealthSummarySchema
>
export type RuntimeListGlobalComponentsInput = z.infer<
  typeof runtimeListGlobalComponentsInputSchema
>
export type RuntimeComponentUpdatedSubscribeInput = z.infer<
  typeof runtimeComponentUpdatedSubscribeInputSchema
>
export type RuntimeListGlobalComponentsResult = z.infer<
  typeof runtimeListGlobalComponentsResultSchema
>
export type RuntimeComponentUpdatedEvent = z.infer<
  typeof runtimeComponentUpdatedEventSchema
>

export function parseRuntimeComponentSnapshot(
  input: unknown,
): RuntimeComponentSnapshot {
  return runtimeComponentSnapshotSchema.parse(input)
}

export function parseProjectRuntimeSnapshot(
  input: unknown,
): ProjectRuntimeSnapshot {
  return projectRuntimeSnapshotSchema.parse(input)
}

export function parseRuntimeHealthCheckSnapshot(
  input: unknown,
): RuntimeHealthCheckSnapshot {
  return runtimeHealthCheckSnapshotSchema.parse(input)
}

export function parseProjectRuntimeHealthSummary(
  input: unknown,
): ProjectRuntimeHealthSummary {
  return projectRuntimeHealthSummarySchema.parse(input)
}

export function parseRuntimeListGlobalComponentsResult(
  input: unknown,
): RuntimeListGlobalComponentsResult {
  return runtimeListGlobalComponentsResultSchema.parse(input)
}

export function parseRuntimeComponentUpdatedEvent(
  input: unknown,
): RuntimeComponentUpdatedEvent {
  return runtimeComponentUpdatedEventSchema.parse(input)
}
