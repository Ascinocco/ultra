import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import {
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
  subscribeRequestEnvelopeSchema,
  subscriptionEventEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"
import { projectIdSchema } from "./projects.js"
import { threadIdSchema } from "./threads.js"

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

export const runtimeProjectScopedInputSchema = z.object({
  project_id: projectIdSchema,
})
export const runtimeListGlobalComponentsInputSchema = z.object({}).strict()
export const runtimeComponentUpdatedSubscribeInputSchema = z.object({}).strict()
export const runtimeRetryThreadInputSchema = z.object({
  project_id: projectIdSchema,
  thread_id: threadIdSchema,
})
export const runtimePauseProjectRuntimeInputSchema = z.object({
  project_id: projectIdSchema,
})
export const runtimeResumeProjectRuntimeInputSchema = z.object({
  project_id: projectIdSchema,
})
export const runtimeCoordinatorCommandResultSchema = z.object({
  accepted: z.boolean(),
  message: z.string().min(1).nullable(),
})

export const runtimeListGlobalComponentsResultSchema = z.object({
  components: z.array(runtimeComponentSnapshotSchema),
})
export const runtimeGetComponentsResultSchema = z.object({
  components: z.array(runtimeComponentSnapshotSchema),
})

export const runtimeGetProjectHealthQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("runtime.get_project_health"),
    payload: runtimeProjectScopedInputSchema,
  })

export const runtimeGetProjectHealthSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: projectRuntimeHealthSummarySchema,
  })

export const runtimeGetProjectRuntimeQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("runtime.get_project_runtime"),
    payload: runtimeProjectScopedInputSchema,
  })

export const runtimeGetProjectRuntimeSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: projectRuntimeSnapshotSchema,
  })

export const runtimeGetComponentsQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("runtime.get_components"),
    payload: runtimeProjectScopedInputSchema,
  })

export const runtimeGetComponentsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: runtimeGetComponentsResultSchema,
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

export const runtimeHealthUpdatedSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("runtime.health_updated"),
    payload: runtimeProjectScopedInputSchema,
  })

export const runtimeHealthUpdatedEventSchema =
  subscriptionEventEnvelopeSchema.extend({
    event_name: z.literal("runtime.health_updated"),
    payload: projectRuntimeHealthSummarySchema,
  })

export const runtimeProjectRuntimeUpdatedSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("runtime.project_runtime_updated"),
    payload: runtimeProjectScopedInputSchema,
  })

export const runtimeProjectRuntimeUpdatedEventSchema =
  subscriptionEventEnvelopeSchema.extend({
    event_name: z.literal("runtime.project_runtime_updated"),
    payload: projectRuntimeSnapshotSchema,
  })

export const runtimeRetryThreadCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("runtime.retry_thread"),
    payload: runtimeRetryThreadInputSchema,
  })

export const runtimePauseProjectRuntimeCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("runtime.pause_project_runtime"),
    payload: runtimePauseProjectRuntimeInputSchema,
  })

export const runtimeResumeProjectRuntimeCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("runtime.resume_project_runtime"),
    payload: runtimeResumeProjectRuntimeInputSchema,
  })

export const runtimeRetryThreadSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: runtimeCoordinatorCommandResultSchema,
  })

export const runtimePauseProjectRuntimeSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: runtimeCoordinatorCommandResultSchema,
  })

export const runtimeResumeProjectRuntimeSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: runtimeCoordinatorCommandResultSchema,
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
export type RuntimeProjectScopedInput = z.infer<
  typeof runtimeProjectScopedInputSchema
>
export type RuntimeListGlobalComponentsInput = z.infer<
  typeof runtimeListGlobalComponentsInputSchema
>
export type RuntimeRetryThreadInput = z.infer<
  typeof runtimeRetryThreadInputSchema
>
export type RuntimePauseProjectRuntimeInput = z.infer<
  typeof runtimePauseProjectRuntimeInputSchema
>
export type RuntimeResumeProjectRuntimeInput = z.infer<
  typeof runtimeResumeProjectRuntimeInputSchema
>
export type RuntimeComponentUpdatedSubscribeInput = z.infer<
  typeof runtimeComponentUpdatedSubscribeInputSchema
>
export type RuntimeListGlobalComponentsResult = z.infer<
  typeof runtimeListGlobalComponentsResultSchema
>
export type RuntimeGetComponentsResult = z.infer<
  typeof runtimeGetComponentsResultSchema
>
export type RuntimeCoordinatorCommandResult = z.infer<
  typeof runtimeCoordinatorCommandResultSchema
>
export type RuntimeComponentUpdatedEvent = z.infer<
  typeof runtimeComponentUpdatedEventSchema
>
export type RuntimeHealthUpdatedEvent = z.infer<
  typeof runtimeHealthUpdatedEventSchema
>
export type RuntimeProjectRuntimeUpdatedEvent = z.infer<
  typeof runtimeProjectRuntimeUpdatedEventSchema
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

export function parseRuntimeGetComponentsResult(
  input: unknown,
): RuntimeGetComponentsResult {
  return runtimeGetComponentsResultSchema.parse(input)
}

export function parseRuntimeListGlobalComponentsResult(
  input: unknown,
): RuntimeListGlobalComponentsResult {
  return runtimeListGlobalComponentsResultSchema.parse(input)
}

export function parseRuntimeCoordinatorCommandResult(
  input: unknown,
): RuntimeCoordinatorCommandResult {
  return runtimeCoordinatorCommandResultSchema.parse(input)
}

export function parseRuntimeComponentUpdatedEvent(
  input: unknown,
): RuntimeComponentUpdatedEvent {
  return runtimeComponentUpdatedEventSchema.parse(input)
}

export function parseRuntimeHealthUpdatedEvent(
  input: unknown,
): RuntimeHealthUpdatedEvent {
  return runtimeHealthUpdatedEventSchema.parse(input)
}

export function parseRuntimeProjectRuntimeUpdatedEvent(
  input: unknown,
): RuntimeProjectRuntimeUpdatedEvent {
  return runtimeProjectRuntimeUpdatedEventSchema.parse(input)
}
