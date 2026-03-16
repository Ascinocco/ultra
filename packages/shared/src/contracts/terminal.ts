import { z } from "zod"

import {
  isoUtcTimestampSchema,
  opaqueIdSchema,
  subscriptionIdSchema,
} from "./constants.js"
import {
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
  subscribeRequestEnvelopeSchema,
  subscriptionEventEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"
import { projectIdSchema } from "./projects.js"
import {
  projectRuntimeProfileSnapshotSchema,
  sandboxContextSnapshotSchema,
  sandboxIdSchema,
  sandboxRuntimeSyncSnapshotSchema,
} from "./sandboxes.js"

export const terminalSessionIdSchema = opaqueIdSchema
export const savedCommandIdSchema = z.enum(["test", "dev", "lint", "build"])
export const terminalSessionKindSchema = z.enum(["shell", "saved_command"])
export const terminalSessionStatusSchema = z.enum([
  "starting",
  "running",
  "exited",
  "failed",
])

export const terminalGetRuntimeProfileInputSchema = z.object({
  project_id: projectIdSchema,
  sandbox_id: sandboxIdSchema.optional(),
})

export const terminalSyncRuntimeFilesInputSchema = z.object({
  project_id: projectIdSchema,
  sandbox_id: sandboxIdSchema.optional(),
  force: z.boolean().optional().default(false),
})

export const terminalOpenInputSchema = z.object({
  project_id: projectIdSchema,
  sandbox_id: sandboxIdSchema.optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  force_new: z.boolean().optional().default(false),
})

export const terminalListSessionsInputSchema = z.object({
  project_id: projectIdSchema,
})

export const terminalListSavedCommandsInputSchema = z.object({
  project_id: projectIdSchema,
})

export const terminalRunSavedCommandInputSchema = z.object({
  project_id: projectIdSchema,
  sandbox_id: sandboxIdSchema.optional(),
  command_id: savedCommandIdSchema,
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
})

export const terminalWriteInputInputSchema = z.object({
  project_id: projectIdSchema,
  session_id: terminalSessionIdSchema,
  input: z.string(),
})

export const terminalResizeSessionInputSchema = z.object({
  project_id: projectIdSchema,
  session_id: terminalSessionIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
})

export const terminalCloseSessionInputSchema = z.object({
  project_id: projectIdSchema,
  session_id: terminalSessionIdSchema,
})

export const terminalSessionsSubscribeInputSchema = z.object({
  project_id: projectIdSchema,
})

export const terminalOutputSubscribeInputSchema = z.object({
  project_id: projectIdSchema,
  session_id: terminalSessionIdSchema,
})

export const terminalRuntimeProfileResultSchema = z.object({
  sandbox: sandboxContextSnapshotSchema,
  profile: projectRuntimeProfileSnapshotSchema,
  sync: sandboxRuntimeSyncSnapshotSchema,
})

export const terminalSessionSnapshotSchema = z.object({
  sessionId: terminalSessionIdSchema,
  projectId: projectIdSchema,
  sandboxId: sandboxIdSchema,
  threadId: z.string().nullable(),
  cwd: z.string().min(1),
  title: z.string().min(1),
  sessionKind: terminalSessionKindSchema,
  status: terminalSessionStatusSchema,
  commandId: savedCommandIdSchema.nullable(),
  commandLabel: z.string().nullable(),
  commandLine: z.string().min(1),
  exitCode: z.number().int().nullable(),
  startedAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  lastOutputAt: isoUtcTimestampSchema.nullable(),
  lastOutputSequence: z.number().int().nonnegative(),
  recentOutput: z.string(),
})

export const savedCommandSnapshotSchema = z.object({
  commandId: savedCommandIdSchema,
  label: z.string().min(1),
  commandLine: z.string().min(1),
  isAvailable: z.boolean(),
  reasonUnavailable: z.string().nullable(),
})

export const terminalListSessionsResultSchema = z.object({
  sessions: z.array(terminalSessionSnapshotSchema),
})

export const terminalListSavedCommandsResultSchema = z.object({
  commands: z.array(savedCommandSnapshotSchema),
})

export const terminalOutputEventPayloadSchema = z.object({
  project_id: projectIdSchema,
  session_id: terminalSessionIdSchema,
  sequence_number: z.number().int().positive(),
  chunk: z.string(),
  occurred_at: isoUtcTimestampSchema,
})

export const terminalSessionsEventPayloadSchema = z.object({
  project_id: projectIdSchema,
  sessions: z.array(terminalSessionSnapshotSchema),
})

export const terminalSubscriptionAcceptedResultSchema = z.object({
  subscription_id: subscriptionIdSchema,
})

export const terminalGetRuntimeProfileQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("terminal.get_runtime_profile"),
    payload: terminalGetRuntimeProfileInputSchema,
  })

export const terminalListSessionsQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("terminal.list_sessions"),
    payload: terminalListSessionsInputSchema,
  })

export const terminalListSavedCommandsQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("terminal.list_saved_commands"),
    payload: terminalListSavedCommandsInputSchema,
  })

export const terminalSyncRuntimeFilesCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("terminal.sync_runtime_files"),
    payload: terminalSyncRuntimeFilesInputSchema,
  })

export const terminalOpenCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("terminal.open"),
  payload: terminalOpenInputSchema,
})

export const terminalRunSavedCommandCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("terminal.run_saved_command"),
    payload: terminalRunSavedCommandInputSchema,
  })

export const terminalWriteInputCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("terminal.write_input"),
    payload: terminalWriteInputInputSchema,
  })

export const terminalResizeSessionCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("terminal.resize_session"),
    payload: terminalResizeSessionInputSchema,
  })

export const terminalCloseSessionCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("terminal.close_session"),
    payload: terminalCloseSessionInputSchema,
  })

export const terminalSessionsSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("terminal.sessions"),
    payload: terminalSessionsSubscribeInputSchema,
  })

export const terminalOutputSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("terminal.output"),
    payload: terminalOutputSubscribeInputSchema,
  })

export const terminalGetRuntimeProfileSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalRuntimeProfileResultSchema,
  })

export const terminalSyncRuntimeFilesSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalRuntimeProfileResultSchema,
  })

export const terminalOpenSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalSessionSnapshotSchema,
  })

export const terminalRunSavedCommandSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalSessionSnapshotSchema,
  })

export const terminalListSessionsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalListSessionsResultSchema,
  })

export const terminalListSavedCommandsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalListSavedCommandsResultSchema,
  })

export const terminalSubscribeSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: terminalSubscriptionAcceptedResultSchema,
  })

export const terminalOutputEventSchema = subscriptionEventEnvelopeSchema.extend(
  {
    event_name: z.literal("terminal.output"),
    payload: terminalOutputEventPayloadSchema,
  },
)

export const terminalSessionsEventSchema =
  subscriptionEventEnvelopeSchema.extend({
    event_name: z.literal("terminal.sessions"),
    payload: terminalSessionsEventPayloadSchema,
  })

export type TerminalGetRuntimeProfileInput = z.infer<
  typeof terminalGetRuntimeProfileInputSchema
>
export type TerminalSyncRuntimeFilesInput = z.infer<
  typeof terminalSyncRuntimeFilesInputSchema
>
export type TerminalOpenInput = z.infer<typeof terminalOpenInputSchema>
export type TerminalListSessionsInput = z.infer<
  typeof terminalListSessionsInputSchema
>
export type TerminalListSavedCommandsInput = z.infer<
  typeof terminalListSavedCommandsInputSchema
>
export type TerminalRunSavedCommandInput = z.infer<
  typeof terminalRunSavedCommandInputSchema
>
export type TerminalWriteInputInput = z.infer<
  typeof terminalWriteInputInputSchema
>
export type TerminalResizeSessionInput = z.infer<
  typeof terminalResizeSessionInputSchema
>
export type TerminalCloseSessionInput = z.infer<
  typeof terminalCloseSessionInputSchema
>
export type TerminalSessionsSubscribeInput = z.infer<
  typeof terminalSessionsSubscribeInputSchema
>
export type TerminalOutputSubscribeInput = z.infer<
  typeof terminalOutputSubscribeInputSchema
>
export type TerminalRuntimeProfileResult = z.infer<
  typeof terminalRuntimeProfileResultSchema
>
export type TerminalSessionId = z.infer<typeof terminalSessionIdSchema>
export type SavedCommandId = z.infer<typeof savedCommandIdSchema>
export type TerminalSessionKind = z.infer<typeof terminalSessionKindSchema>
export type TerminalSessionStatus = z.infer<typeof terminalSessionStatusSchema>
export type TerminalSessionSnapshot = z.infer<
  typeof terminalSessionSnapshotSchema
>
export type SavedCommandSnapshot = z.infer<typeof savedCommandSnapshotSchema>
export type TerminalListSessionsResult = z.infer<
  typeof terminalListSessionsResultSchema
>
export type TerminalListSavedCommandsResult = z.infer<
  typeof terminalListSavedCommandsResultSchema
>
export type TerminalOutputEventPayload = z.infer<
  typeof terminalOutputEventPayloadSchema
>
export type TerminalSessionsEventPayload = z.infer<
  typeof terminalSessionsEventPayloadSchema
>
export type TerminalOutputEvent = z.infer<typeof terminalOutputEventSchema>
export type TerminalSessionsEvent = z.infer<typeof terminalSessionsEventSchema>

export function parseTerminalRuntimeProfileResult(
  input: unknown,
): TerminalRuntimeProfileResult {
  return terminalRuntimeProfileResultSchema.parse(input)
}

export function parseTerminalSessionSnapshot(
  input: unknown,
): TerminalSessionSnapshot {
  return terminalSessionSnapshotSchema.parse(input)
}

export function parseSavedCommandSnapshot(
  input: unknown,
): SavedCommandSnapshot {
  return savedCommandSnapshotSchema.parse(input)
}

export function parseTerminalListSessionsResult(
  input: unknown,
): TerminalListSessionsResult {
  return terminalListSessionsResultSchema.parse(input)
}

export function parseTerminalListSavedCommandsResult(
  input: unknown,
): TerminalListSavedCommandsResult {
  return terminalListSavedCommandsResultSchema.parse(input)
}

export function parseTerminalOutputEvent(input: unknown): TerminalOutputEvent {
  return terminalOutputEventSchema.parse(input)
}

export function parseTerminalSessionsEvent(
  input: unknown,
): TerminalSessionsEvent {
  return terminalSessionsEventSchema.parse(input)
}
