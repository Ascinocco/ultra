import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import { projectIdSchema } from "./projects.js"
import { threadIdSchema } from "./threads.js"

export const artifactIdSchema = opaqueIdSchema
export const artifactTypeSchema = z.enum([
  "runtime_output_bundle",
  "terminal_output_bundle",
  "combined_debug_bundle",
])
export const artifactSourceSurfaceSchema = z.enum([
  "runtime",
  "terminal",
  "combined",
  "browser",
  "system",
])

export const artifactLargeContentRefSchema = z.object({
  logicalKey: z.string().min(1),
  relativePath: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  contentType: z.string().min(1),
})

export const artifactSourceSchema = z.object({
  surface: artifactSourceSurfaceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const runtimeOutputPayloadSchema = z.object({
  processType: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().min(1),
  exitCode: z.number().int().nullable(),
  terminalOutput: z.string(),
  debugOutput: z.string().nullable().optional(),
})

export const terminalOutputPayloadSchema = z.object({
  command: z.string().min(1).nullable().optional(),
  cwd: z.string().min(1),
  exitCode: z.number().int().nullable(),
  output: z.string(),
})

export const combinedDebugPayloadSchema = z.object({
  runtime: runtimeOutputPayloadSchema.optional(),
  terminal: terminalOutputPayloadSchema.optional(),
  thread: z
    .object({
      threadId: threadIdSchema,
      title: z.string().min(1).optional(),
      executionState: z.string().min(1).optional(),
      reviewState: z.string().min(1).optional(),
      publishState: z.string().min(1).optional(),
    })
    .optional(),
  sandbox: z
    .object({
      sandboxId: opaqueIdSchema.optional(),
      displayName: z.string().min(1).optional(),
      syncStatus: z.string().min(1).optional(),
    })
    .optional(),
  diagnostics: z.record(z.string(), z.unknown()).default({}),
})

const artifactBundleBaseSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  capturedAt: isoUtcTimestampSchema,
  source: artifactSourceSchema,
  largeContentRefs: z
    .array(artifactLargeContentRefSchema)
    .optional()
    .default([]),
})

export const runtimeOutputBundleSchema = artifactBundleBaseSchema.extend({
  artifactType: z.literal("runtime_output_bundle"),
  payload: runtimeOutputPayloadSchema,
})

export const terminalOutputBundleSchema = artifactBundleBaseSchema.extend({
  artifactType: z.literal("terminal_output_bundle"),
  payload: terminalOutputPayloadSchema,
})

export const combinedDebugBundleSchema = artifactBundleBaseSchema.extend({
  artifactType: z.literal("combined_debug_bundle"),
  payload: combinedDebugPayloadSchema,
})

export const artifactBundleSchema = z.discriminatedUnion("artifactType", [
  runtimeOutputBundleSchema,
  terminalOutputBundleSchema,
  combinedDebugBundleSchema,
])

export const artifactStoredBundleSchema = z.object({
  artifactType: artifactTypeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  capturedAt: isoUtcTimestampSchema,
  source: artifactSourceSchema,
  payload: z.record(z.string(), z.unknown()),
  largeContentRefs: z.array(artifactLargeContentRefSchema).default([]),
})

export const artifactSnapshotSchema = z.object({
  artifactId: artifactIdSchema,
  projectId: projectIdSchema,
  threadId: threadIdSchema,
  artifactType: artifactTypeSchema,
  title: z.string().min(1),
  path: z.string().min(1).nullable(),
  metadata: artifactStoredBundleSchema,
  createdAt: isoUtcTimestampSchema,
})

export const artifactStoreInputSchema = z.object({
  projectId: projectIdSchema,
  threadId: threadIdSchema,
  bundle: artifactBundleSchema,
})

export const artifactLoadResultSchema = z.object({
  artifact: artifactSnapshotSchema,
  bundle: artifactBundleSchema,
})

export function parseArtifactBundle(value: unknown): ArtifactBundle {
  return artifactBundleSchema.parse(value)
}

export function parseArtifactStoredBundle(
  value: unknown,
): ArtifactStoredBundle {
  return artifactStoredBundleSchema.parse(value)
}

export function parseArtifactSnapshot(value: unknown): ArtifactSnapshot {
  return artifactSnapshotSchema.parse(value)
}

export function parseArtifactStoreInput(value: unknown): ArtifactStoreInput {
  return artifactStoreInputSchema.parse(value)
}

export function parseArtifactLoadResult(value: unknown): ArtifactLoadResult {
  return artifactLoadResultSchema.parse(value)
}

export type ArtifactId = z.infer<typeof artifactIdSchema>
export type ArtifactType = z.infer<typeof artifactTypeSchema>
export type ArtifactSourceSurface = z.infer<typeof artifactSourceSurfaceSchema>
export type ArtifactLargeContentRef = z.infer<
  typeof artifactLargeContentRefSchema
>
export type ArtifactSource = z.infer<typeof artifactSourceSchema>
export type RuntimeOutputPayload = z.infer<typeof runtimeOutputPayloadSchema>
export type TerminalOutputPayload = z.infer<typeof terminalOutputPayloadSchema>
export type CombinedDebugPayload = z.infer<typeof combinedDebugPayloadSchema>
export type RuntimeOutputBundle = z.infer<typeof runtimeOutputBundleSchema>
export type TerminalOutputBundle = z.infer<typeof terminalOutputBundleSchema>
export type CombinedDebugBundle = z.infer<typeof combinedDebugBundleSchema>
export type ArtifactBundle = z.infer<typeof artifactBundleSchema>
export type ArtifactStoredBundle = z.infer<typeof artifactStoredBundleSchema>
export type ArtifactSnapshot = z.infer<typeof artifactSnapshotSchema>
export type ArtifactStoreInput = z.infer<typeof artifactStoreInputSchema>
export type ArtifactLoadResult = z.infer<typeof artifactLoadResultSchema>
