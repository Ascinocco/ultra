import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import { projectIdSchema, projectPathSchema } from "./projects.js"

export const sandboxIdSchema = opaqueIdSchema
export const sandboxTypeSchema = z.enum(["main_checkout", "thread_sandbox"])
export const runtimeSyncModeSchema = z.enum(["managed_copy"])
export const sandboxRuntimeSyncStatusSchema = z.enum([
  "unknown",
  "synced",
  "stale",
  "failed",
])
export const runtimeProfileEnvVarsSchema = z.record(z.string(), z.string())
export const sandboxRuntimeSyncDetailsSchema = z.record(z.string(), z.unknown())

export const sandboxContextSnapshotSchema = z.object({
  sandboxId: sandboxIdSchema,
  projectId: projectIdSchema,
  threadId: opaqueIdSchema.nullable(),
  path: projectPathSchema,
  displayName: z.string().min(1),
  sandboxType: sandboxTypeSchema,
  branchName: z.string().min(1).nullable(),
  baseBranch: z.string().min(1).nullable(),
  isMainCheckout: z.boolean(),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  lastUsedAt: isoUtcTimestampSchema.nullable(),
})

export const projectRuntimeProfileSnapshotSchema = z.object({
  projectId: projectIdSchema,
  runtimeFilePaths: z.array(z.string().min(1)),
  envVars: runtimeProfileEnvVarsSchema,
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
})

export const sandboxRuntimeSyncSnapshotSchema = z.object({
  syncId: opaqueIdSchema,
  sandboxId: sandboxIdSchema,
  projectId: projectIdSchema,
  syncMode: runtimeSyncModeSchema,
  status: sandboxRuntimeSyncStatusSchema,
  syncedFiles: z.array(z.string().min(1)),
  lastSyncedAt: isoUtcTimestampSchema.nullable(),
  details: sandboxRuntimeSyncDetailsSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
})

export type SandboxId = z.infer<typeof sandboxIdSchema>
export type SandboxType = z.infer<typeof sandboxTypeSchema>
export type RuntimeSyncMode = z.infer<typeof runtimeSyncModeSchema>
export type SandboxRuntimeSyncStatus = z.infer<
  typeof sandboxRuntimeSyncStatusSchema
>
export type RuntimeProfileEnvVars = z.infer<typeof runtimeProfileEnvVarsSchema>
export type SandboxRuntimeSyncDetails = z.infer<
  typeof sandboxRuntimeSyncDetailsSchema
>
export type SandboxContextSnapshot = z.infer<
  typeof sandboxContextSnapshotSchema
>
export type ProjectRuntimeProfileSnapshot = z.infer<
  typeof projectRuntimeProfileSnapshotSchema
>
export type SandboxRuntimeSyncSnapshot = z.infer<
  typeof sandboxRuntimeSyncSnapshotSchema
>

export function parseSandboxContextSnapshot(
  input: unknown,
): SandboxContextSnapshot {
  return sandboxContextSnapshotSchema.parse(input)
}

export function parseProjectRuntimeProfileSnapshot(
  input: unknown,
): ProjectRuntimeProfileSnapshot {
  return projectRuntimeProfileSnapshotSchema.parse(input)
}

export function parseSandboxRuntimeSyncSnapshot(
  input: unknown,
): SandboxRuntimeSyncSnapshot {
  return sandboxRuntimeSyncSnapshotSchema.parse(input)
}
