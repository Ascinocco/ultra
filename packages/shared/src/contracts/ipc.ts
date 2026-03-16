import { z } from "zod"

import {
  ipcErrorCodeSchema,
  protocolVersionSchema,
  requestIdSchema,
  subscriptionIdSchema,
} from "./constants.js"

export const queryMethodSchema = z.enum([
  "system.hello",
  "system.get_backend_info",
  "system.get_environment_readiness",
  "system.ping",
  "runtime.list_global_components",
  "chats.list",
  "chats.get",
  "terminal.get_runtime_profile",
  "terminal.list_sessions",
  "terminal.list_saved_commands",
  "sandboxes.list",
  "sandboxes.get_active",
  "projects.list",
  "projects.get",
  "projects.get_layout",
  "threads.list_by_project",
  "threads.list_by_chat",
  "threads.get",
  "threads.get_events",
  "threads.get_messages",
])

export const commandMethodSchema = z.enum([
  "artifacts.capture_runtime",
  "system.recheck_environment",
  "chats.create",
  "chats.rename",
  "chats.pin",
  "chats.unpin",
  "chats.archive",
  "chats.restore",
  "chats.start_thread",
  "chats.promote_work_to_thread",
  "terminal.open",
  "terminal.run_saved_command",
  "terminal.sync_runtime_files",
  "terminal.write_input",
  "terminal.resize_session",
  "terminal.close_session",
  "terminal.rename_session",
  "terminal.pin_session",
  "sandboxes.set_active",
  "projects.open",
  "projects.set_layout",
  "threads.send_message",
])

export const subscriptionMethodSchema = z.enum([
  "projects.updated",
  "projects.layout_updated",
  "runtime.component_updated",
  "terminal.sessions",
  "terminal.output",
])

export const queryRequestEnvelopeSchema = z.object({
  protocol_version: protocolVersionSchema,
  request_id: requestIdSchema,
  type: z.literal("query"),
  name: queryMethodSchema,
  payload: z.unknown(),
})

export const commandRequestEnvelopeSchema = z.object({
  protocol_version: protocolVersionSchema,
  request_id: requestIdSchema,
  type: z.literal("command"),
  name: commandMethodSchema,
  payload: z.unknown(),
})

export const subscribeRequestEnvelopeSchema = z.object({
  protocol_version: protocolVersionSchema,
  request_id: requestIdSchema,
  type: z.literal("subscribe"),
  name: subscriptionMethodSchema,
  payload: z.unknown(),
})

export const successResponseEnvelopeSchema = z.object({
  protocol_version: protocolVersionSchema,
  request_id: requestIdSchema,
  type: z.literal("response"),
  ok: z.literal(true),
  result: z.unknown(),
})

export const errorResponseEnvelopeSchema = z.object({
  protocol_version: protocolVersionSchema,
  request_id: requestIdSchema,
  type: z.literal("response"),
  ok: z.literal(false),
  error: z.object({
    code: ipcErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
})

export const subscriptionEventEnvelopeSchema = z.object({
  protocol_version: protocolVersionSchema,
  type: z.literal("event"),
  subscription_id: subscriptionIdSchema,
  event_name: z.string().min(1),
  payload: z.unknown(),
})

export const ipcRequestEnvelopeSchema = z.union([
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
  subscribeRequestEnvelopeSchema,
])

export const ipcResponseEnvelopeSchema = z.union([
  successResponseEnvelopeSchema,
  errorResponseEnvelopeSchema,
])

export type QueryMethodName = z.infer<typeof queryMethodSchema>
export type CommandMethodName = z.infer<typeof commandMethodSchema>
export type SubscriptionMethodName = z.infer<typeof subscriptionMethodSchema>
export type QueryRequestEnvelope = z.infer<typeof queryRequestEnvelopeSchema>
export type CommandRequestEnvelope = z.infer<
  typeof commandRequestEnvelopeSchema
>
export type SubscribeRequestEnvelope = z.infer<
  typeof subscribeRequestEnvelopeSchema
>
export type SuccessResponseEnvelope = z.infer<
  typeof successResponseEnvelopeSchema
>
export type ErrorResponseEnvelope = z.infer<typeof errorResponseEnvelopeSchema>
export type SubscriptionEventEnvelope = z.infer<
  typeof subscriptionEventEnvelopeSchema
>
export type IpcRequestEnvelope = z.infer<typeof ipcRequestEnvelopeSchema>
export type IpcResponseEnvelope = z.infer<typeof ipcResponseEnvelopeSchema>

export function parseQueryRequest(input: unknown): QueryRequestEnvelope {
  return queryRequestEnvelopeSchema.parse(input)
}

export function parseCommandRequest(input: unknown): CommandRequestEnvelope {
  return commandRequestEnvelopeSchema.parse(input)
}

export function parseSubscribeRequest(
  input: unknown,
): SubscribeRequestEnvelope {
  return subscribeRequestEnvelopeSchema.parse(input)
}

export function parseIpcRequestEnvelope(input: unknown): IpcRequestEnvelope {
  return ipcRequestEnvelopeSchema.parse(input)
}

export function parseIpcResponseEnvelope(input: unknown): IpcResponseEnvelope {
  return ipcResponseEnvelopeSchema.parse(input)
}

export function parseSubscriptionEventEnvelope(
  input: unknown,
): SubscriptionEventEnvelope {
  return subscriptionEventEnvelopeSchema.parse(input)
}
