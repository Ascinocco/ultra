import { z } from "zod"

import { appPageSchema, opaqueIdSchema } from "./constants.js"

export const projectLayoutStateSchema = z.object({
  currentPage: appPageSchema,
  rightTopCollapsed: z.boolean(),
  selectedRightPaneTab: z.string().min(1).nullable(),
  activeChatId: opaqueIdSchema.nullable(),
  selectedThreadId: opaqueIdSchema.nullable(),
  lastEditorTargetId: opaqueIdSchema.nullable(),
  sidebarCollapsed: z.boolean(),
  chatThreadSplitRatio: z.number(),
})

// Lenient schema that strips unknown fields from persisted rows.
// Old rows may still contain removed fields (e.g. rightBottomCollapsed,
// selectedBottomPaneTab) — passthrough lets them through and the transform
// drops them by picking only the known keys.
export const projectLayoutStateLenientSchema = projectLayoutStateSchema
  .passthrough()
  .transform((val): ProjectLayoutState => {
    return {
      currentPage: val.currentPage,
      rightTopCollapsed: val.rightTopCollapsed,
      selectedRightPaneTab: val.selectedRightPaneTab,
      activeChatId: val.activeChatId,
      selectedThreadId: val.selectedThreadId,
      lastEditorTargetId: val.lastEditorTargetId,
      sidebarCollapsed: val.sidebarCollapsed,
      chatThreadSplitRatio: val.chatThreadSplitRatio,
    }
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
  return projectLayoutStateLenientSchema.parse(input)
}
