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

// Lenient schema for parsing persisted rows. Old rows may lack new fields
// (sidebarCollapsed, chatThreadSplitRatio) or contain removed fields
// (rightBottomCollapsed, selectedBottomPaneTab). Defaults fill missing fields;
// passthrough + transform strips unknown ones.
export const projectLayoutStateLenientSchema = z
  .object({
    currentPage: appPageSchema,
    rightTopCollapsed: z.boolean(),
    selectedRightPaneTab: z.string().min(1).nullable(),
    activeChatId: opaqueIdSchema.nullable(),
    selectedThreadId: opaqueIdSchema.nullable(),
    lastEditorTargetId: opaqueIdSchema.nullable(),
    sidebarCollapsed: z.boolean().default(false),
    chatThreadSplitRatio: z.number().default(0.55),
  })
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
