import { z } from "zod"

import { appPageSchema, opaqueIdSchema } from "./constants.js"

export const projectLayoutStateSchema = z.object({
  currentPage: appPageSchema,
  rightTopCollapsed: z.boolean(),
  rightBottomCollapsed: z.boolean(),
  selectedRightPaneTab: z.string().min(1).nullable(),
  selectedBottomPaneTab: z.string().min(1).nullable(),
  activeChatId: opaqueIdSchema.nullable(),
  selectedThreadId: opaqueIdSchema.nullable(),
  lastEditorTargetId: opaqueIdSchema.nullable(),
})

export const projectsGetLayoutInputSchema = z.object({
  project_id: opaqueIdSchema,
})

export const projectsSetLayoutInputSchema = z.object({
  project_id: opaqueIdSchema,
  layout: projectLayoutStateSchema,
})

export type ProjectLayoutState = z.infer<typeof projectLayoutStateSchema>
export type ProjectsGetLayoutInput = z.infer<
  typeof projectsGetLayoutInputSchema
>
export type ProjectsSetLayoutInput = z.infer<
  typeof projectsSetLayoutInputSchema
>

export function parseProjectLayoutState(input: unknown): ProjectLayoutState {
  return projectLayoutStateSchema.parse(input)
}
