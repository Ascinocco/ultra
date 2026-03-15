import { z } from "zod"

import {
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"
import { projectIdSchema } from "./projects.js"
import {
  projectRuntimeProfileSnapshotSchema,
  sandboxContextSnapshotSchema,
  sandboxIdSchema,
  sandboxRuntimeSyncSnapshotSchema,
} from "./sandboxes.js"

export const terminalGetRuntimeProfileInputSchema = z.object({
  project_id: projectIdSchema,
  sandbox_id: sandboxIdSchema.optional(),
})

export const terminalSyncRuntimeFilesInputSchema = z.object({
  project_id: projectIdSchema,
  sandbox_id: sandboxIdSchema.optional(),
  force: z.boolean().optional().default(false),
})

export const terminalRuntimeProfileResultSchema = z.object({
  sandbox: sandboxContextSnapshotSchema,
  profile: projectRuntimeProfileSnapshotSchema,
  sync: sandboxRuntimeSyncSnapshotSchema,
})

export const terminalGetRuntimeProfileQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("terminal.get_runtime_profile"),
    payload: terminalGetRuntimeProfileInputSchema,
  })

export const terminalSyncRuntimeFilesCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("terminal.sync_runtime_files"),
    payload: terminalSyncRuntimeFilesInputSchema,
  })

export const terminalGetRuntimeProfileSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalRuntimeProfileResultSchema,
  })

export const terminalSyncRuntimeFilesSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalRuntimeProfileResultSchema,
  })

export type TerminalGetRuntimeProfileInput = z.infer<
  typeof terminalGetRuntimeProfileInputSchema
>
export type TerminalSyncRuntimeFilesInput = z.infer<
  typeof terminalSyncRuntimeFilesInputSchema
>
export type TerminalRuntimeProfileResult = z.infer<
  typeof terminalRuntimeProfileResultSchema
>

export function parseTerminalRuntimeProfileResult(
  input: unknown,
): TerminalRuntimeProfileResult {
  return terminalRuntimeProfileResultSchema.parse(input)
}
