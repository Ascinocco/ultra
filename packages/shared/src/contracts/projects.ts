import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import {
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
  subscriptionEventEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"
import {
  projectLayoutStateSchema,
  projectsGetLayoutInputSchema,
  projectsSetLayoutInputSchema,
} from "./layout.js"

export const projectIdSchema = opaqueIdSchema
export const projectKeySchema = z.string().min(1)
export const projectPathSchema = z.string().min(1)

export const projectSnapshotSchema = z.object({
  id: projectIdSchema,
  key: projectKeySchema,
  name: z.string().min(1),
  rootPath: projectPathSchema,
  gitRootPath: projectPathSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  lastOpenedAt: isoUtcTimestampSchema.nullable(),
})

export const projectSummarySchema = projectSnapshotSchema

export const projectOpenInputSchema = z.object({
  path: projectPathSchema,
})

export const projectsListRequestPayloadSchema = z.object({}).strict()
export const projectsGetInputSchema = z.object({
  project_id: projectIdSchema,
})

export const projectsUpdatedEventPayloadSchema = z.object({
  project: projectSnapshotSchema,
})

export const projectsLayoutUpdatedEventPayloadSchema = z.object({
  project_id: projectIdSchema,
  layout: projectLayoutStateSchema,
})

export const projectsListQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("projects.list"),
  payload: projectsListRequestPayloadSchema,
})

export const projectsGetQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("projects.get"),
  payload: projectsGetInputSchema,
})

export const projectsGetLayoutQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("projects.get_layout"),
  payload: projectsGetLayoutInputSchema,
})

export const projectsOpenCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("projects.open"),
  payload: projectOpenInputSchema,
})

export const projectsSetLayoutCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("projects.set_layout"),
    payload: projectsSetLayoutInputSchema,
  })

export const projectsListSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: z.object({
      projects: z.array(projectSummarySchema),
    }),
  })

export const projectsGetSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: projectSnapshotSchema,
  })

export const projectsOpenSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: projectSnapshotSchema,
  })

export const projectsGetLayoutSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: projectLayoutStateSchema,
  })

export const projectsUpdatedEventSchema =
  subscriptionEventEnvelopeSchema.extend({
    event_name: z.literal("projects.updated"),
    payload: projectsUpdatedEventPayloadSchema,
  })

export const projectsLayoutUpdatedEventSchema =
  subscriptionEventEnvelopeSchema.extend({
    event_name: z.literal("projects.layout_updated"),
    payload: projectsLayoutUpdatedEventPayloadSchema,
  })

export type ProjectId = z.infer<typeof projectIdSchema>
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>
export type ProjectSummary = z.infer<typeof projectSummarySchema>
export type ProjectOpenInput = z.infer<typeof projectOpenInputSchema>
export type ProjectsGetInput = z.infer<typeof projectsGetInputSchema>
export type ProjectsListResult = z.infer<
  typeof projectsListSuccessResponseSchema
>["result"]
export type ProjectsUpdatedEventPayload = z.infer<
  typeof projectsUpdatedEventPayloadSchema
>
export type ProjectsLayoutUpdatedEventPayload = z.infer<
  typeof projectsLayoutUpdatedEventPayloadSchema
>
export type ProjectsOpenCommand = z.infer<typeof projectsOpenCommandSchema>
export type ProjectsSetLayoutCommand = z.infer<
  typeof projectsSetLayoutCommandSchema
>

export function parseProjectSnapshot(input: unknown): ProjectSnapshot {
  return projectSnapshotSchema.parse(input)
}

export function parseProjectOpenInput(input: unknown): ProjectOpenInput {
  return projectOpenInputSchema.parse(input)
}

export function parseProjectsListResult(input: unknown): ProjectsListResult {
  return projectsListSuccessResponseSchema.shape.result.parse(input)
}
