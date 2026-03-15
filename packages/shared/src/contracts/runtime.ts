import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
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
