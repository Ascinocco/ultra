import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import {
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
  subscribeRequestEnvelopeSchema,
  subscriptionEventEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"
import { projectIdSchema } from "./projects.js"

export const chatIdSchema = opaqueIdSchema
export const chatStatusSchema = z.enum(["active", "archived"])
export const chatProviderSchema = z.enum(["codex", "claude"])
export const chatPermissionLevelSchema = z.enum(["supervised", "full_access"])
export const chatSidebarTurnStatusSchema = z.enum([
  "running",
  "waiting_for_input",
  "error",
])
export const chatThinkingLevelSchema = z.string().min(1)

export const chatSnapshotSchema = z.object({
  id: chatIdSchema,
  projectId: projectIdSchema,
  title: z.string().min(1),
  status: chatStatusSchema,
  provider: chatProviderSchema,
  model: z.string().min(1),
  thinkingLevel: chatThinkingLevelSchema,
  permissionLevel: chatPermissionLevelSchema,
  isPinned: z.boolean(),
  pinnedAt: isoUtcTimestampSchema.nullable(),
  archivedAt: isoUtcTimestampSchema.nullable(),
  lastCompactedAt: isoUtcTimestampSchema.nullable(),
  currentSessionId: opaqueIdSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  workspaceDescription: z.string().nullable(),
  turnStatus: chatSidebarTurnStatusSchema.nullable(),
})

export const chatSummarySchema = chatSnapshotSchema

export const chatSessionSnapshotSchema = z.object({
  id: opaqueIdSchema,
  chatId: chatIdSchema,
  sequenceNumber: z.number().int().positive(),
  startedAt: isoUtcTimestampSchema,
  endedAt: isoUtcTimestampSchema.nullable(),
  compactionSourceSessionId: opaqueIdSchema.nullable(),
  compactionSummary: z.string().nullable(),
  continuationPrompt: z.string().nullable(),
})

export const chatMessageSnapshotSchema = z.object({
  id: opaqueIdSchema,
  chatId: chatIdSchema,
  sessionId: opaqueIdSchema,
  role: z.string().min(1),
  messageType: z.string().min(1),
  contentMarkdown: z.string().nullable(),
  structuredPayloadJson: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  createdAt: isoUtcTimestampSchema,
})

export const chatTurnIdSchema = opaqueIdSchema
export const chatTurnStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
])

export const chatTurnSnapshotSchema = z.object({
  turnId: chatTurnIdSchema,
  chatId: chatIdSchema,
  sessionId: opaqueIdSchema,
  clientTurnId: z.string().nullable(),
  userMessageId: opaqueIdSchema,
  assistantMessageId: opaqueIdSchema.nullable(),
  status: chatTurnStatusSchema,
  provider: chatProviderSchema,
  model: z.string().min(1),
  vendorSessionId: z.string().nullable(),
  startedAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  completedAt: isoUtcTimestampSchema.nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  cancelRequestedAt: isoUtcTimestampSchema.nullable(),
})

export const chatTurnSummarySchema = chatTurnSnapshotSchema
export const chatTurnEventPayloadSchema = z.record(z.string(), z.unknown())
export const chatTurnEventSnapshotSchema = z.object({
  eventId: opaqueIdSchema,
  chatId: chatIdSchema,
  turnId: chatTurnIdSchema,
  sequenceNumber: z.number().int().positive(),
  eventType: z.string().min(1),
  source: z.string().min(1),
  actorType: z.string().min(1),
  actorId: z.string().nullable(),
  payload: chatTurnEventPayloadSchema,
  occurredAt: isoUtcTimestampSchema,
  recordedAt: isoUtcTimestampSchema,
})

export const chatsListResultSchema = z.object({
  chats: z.array(chatSummarySchema),
})

export const chatsGetMessagesResultSchema = z.object({
  messages: z.array(chatMessageSnapshotSchema),
})

export const chatsStartTurnResultSchema = z.object({
  accepted: z.literal(true),
  turn: chatTurnSnapshotSchema,
})

export const chatsListTurnsResultSchema = z.object({
  turns: z.array(chatTurnSummarySchema),
  nextCursor: z.string().nullable(),
})

export const chatsGetTurnEventsResultSchema = z.object({
  events: z.array(chatTurnEventSnapshotSchema),
})

export const chatsSendMessageResultSchema = z.object({
  userMessage: chatMessageSnapshotSchema,
  assistantMessage: chatMessageSnapshotSchema,
  checkpointIds: z.array(opaqueIdSchema),
})

export const chatsCreateInputSchema = z.object({
  project_id: projectIdSchema,
})

export const chatsGetInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsListInputSchema = z.object({
  project_id: projectIdSchema,
  include_archived: z.boolean().optional(),
})

export const chatsGetMessagesInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsRenameInputSchema = z.object({
  chat_id: chatIdSchema,
  title: z.string().min(1),
})

export const chatsUpdateRuntimeConfigInputSchema = z.object({
  chat_id: chatIdSchema,
  provider: chatProviderSchema,
  model: z.string().min(1),
  thinking_level: chatThinkingLevelSchema,
  permission_level: chatPermissionLevelSchema,
})

export const chatsPinInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsUnpinInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsArchiveInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsRestoreInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsSendMessageInputSchema = z.object({
  chat_id: chatIdSchema,
  prompt: z.string().min(1),
})

export const chatAttachmentSchema = z.object({
  type: z.enum(["image", "text"]),
  name: z.string(),
  media_type: z.string(),
  data: z.string(), // base64 encoded
})

export const chatsStartTurnInputSchema = z.object({
  chat_id: chatIdSchema,
  prompt: z.string().min(1),
  client_turn_id: z.string().min(1).optional(),
  attachments: z.array(chatAttachmentSchema).optional(),
})

export const chatsCancelTurnInputSchema = z.object({
  chat_id: chatIdSchema,
  turn_id: chatTurnIdSchema,
})

export const chatsGetTurnInputSchema = z.object({
  chat_id: chatIdSchema,
  turn_id: chatTurnIdSchema,
})

export const chatsListTurnsInputSchema = z.object({
  chat_id: chatIdSchema,
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional(),
})

export const chatsGetTurnEventsInputSchema = z.object({
  chat_id: chatIdSchema,
  turn_id: chatTurnIdSchema,
  from_sequence: z.number().int().positive().optional(),
})

export const chatsApprovePlanInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsApproveSpecsInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsCreatePlanMarkerInputSchema = z.object({
  chat_id: chatIdSchema,
  marker_type: z.enum(["open", "close"]),
})

export const chatsCreateCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.create"),
  payload: chatsCreateInputSchema,
})

export const chatsRenameCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.rename"),
  payload: chatsRenameInputSchema,
})

export const chatsUpdateRuntimeConfigCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("chats.update_runtime_config"),
    payload: chatsUpdateRuntimeConfigInputSchema,
  })

export const chatsPinCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.pin"),
  payload: chatsPinInputSchema,
})

export const chatsUnpinCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.unpin"),
  payload: chatsUnpinInputSchema,
})

export const chatsArchiveCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.archive"),
  payload: chatsArchiveInputSchema,
})

export const chatsRestoreCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.restore"),
  payload: chatsRestoreInputSchema,
})

export const chatsGetQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("chats.get"),
  payload: chatsGetInputSchema,
})

export const chatsListQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("chats.list"),
  payload: chatsListInputSchema,
})

export const chatsGetMessagesQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("chats.get_messages"),
  payload: chatsGetMessagesInputSchema,
})

export const chatsSendMessageCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("chats.send_message"),
    payload: chatsSendMessageInputSchema,
  })

export const chatsStartTurnCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.start_turn"),
  payload: chatsStartTurnInputSchema,
})

export const chatsCancelTurnCommandSchema = commandRequestEnvelopeSchema.extend(
  {
    name: z.literal("chats.cancel_turn"),
    payload: chatsCancelTurnInputSchema,
  },
)

export const chatsGetTurnQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("chats.get_turn"),
  payload: chatsGetTurnInputSchema,
})

export const chatsListTurnsQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("chats.list_turns"),
  payload: chatsListTurnsInputSchema,
})

export const chatsGetTurnEventsQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("chats.get_turn_events"),
  payload: chatsGetTurnEventsInputSchema,
})

export const chatsApprovePlanCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("chats.approve_plan"),
    payload: chatsApprovePlanInputSchema,
  })

export const chatsApproveSpecsCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("chats.approve_specs"),
    payload: chatsApproveSpecsInputSchema,
  })

export const chatsMessagesSubscribeInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsTurnEventsSubscribeInputSchema = z.object({
  chat_id: chatIdSchema,
  turn_id: chatTurnIdSchema.optional(),
})

export const chatsMessagesSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("chats.messages"),
    payload: chatsMessagesSubscribeInputSchema,
  })

export const chatsTurnEventsSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("chats.turn_events"),
    payload: chatsTurnEventsSubscribeInputSchema,
  })

export const chatsCreateSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatSnapshotSchema,
  })

export const chatsGetSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatSnapshotSchema,
  })

export const chatsListSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatsListResultSchema,
  })

export const chatsGetMessagesSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatsGetMessagesResultSchema,
  })

export const chatsUpdateRuntimeConfigSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatSnapshotSchema,
  })

export const chatsStartTurnSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatsStartTurnResultSchema,
  })

export const chatsCancelTurnSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatTurnSnapshotSchema,
  })

export const chatsGetTurnSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatTurnSnapshotSchema,
  })

export const chatsListTurnsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatsListTurnsResultSchema,
  })

export const chatsGetTurnEventsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatsGetTurnEventsResultSchema,
  })

export const chatsSendMessageSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatsSendMessageResultSchema,
  })

export const chatsApprovePlanSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatMessageSnapshotSchema,
  })

export const chatsApproveSpecsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: chatMessageSnapshotSchema,
  })

export const chatsMessagesEventSchema = subscriptionEventEnvelopeSchema.extend({
  event_name: z.literal("chats.messages"),
  payload: chatMessageSnapshotSchema,
})

export const chatsTurnEventsEventSchema =
  subscriptionEventEnvelopeSchema.extend({
    event_name: z.literal("chats.turn_events"),
    payload: chatTurnEventSnapshotSchema,
  })

export type ChatId = z.infer<typeof chatIdSchema>
export type ChatSnapshot = z.infer<typeof chatSnapshotSchema>
export type ChatSummary = z.infer<typeof chatSummarySchema>
export type ChatSidebarTurnStatus = z.infer<typeof chatSidebarTurnStatusSchema>
export type ChatSessionSnapshot = z.infer<typeof chatSessionSnapshotSchema>
export type ChatMessageSnapshot = z.infer<typeof chatMessageSnapshotSchema>
export type ChatTurnId = z.infer<typeof chatTurnIdSchema>
export type ChatTurnStatus = z.infer<typeof chatTurnStatusSchema>
export type ChatTurnSnapshot = z.infer<typeof chatTurnSnapshotSchema>
export type ChatTurnSummary = z.infer<typeof chatTurnSummarySchema>
export type ChatTurnEventSnapshot = z.infer<typeof chatTurnEventSnapshotSchema>
export type ChatsCreateInput = z.infer<typeof chatsCreateInputSchema>
export type ChatsGetInput = z.infer<typeof chatsGetInputSchema>
export type ChatsListInput = z.infer<typeof chatsListInputSchema>
export type ChatsGetMessagesInput = z.infer<typeof chatsGetMessagesInputSchema>
export type ChatsUpdateRuntimeConfigInput = z.infer<
  typeof chatsUpdateRuntimeConfigInputSchema
>
export type ChatsStartTurnInput = z.infer<typeof chatsStartTurnInputSchema>
export type ChatsCancelTurnInput = z.infer<typeof chatsCancelTurnInputSchema>
export type ChatsGetTurnInput = z.infer<typeof chatsGetTurnInputSchema>
export type ChatsListTurnsInput = z.infer<typeof chatsListTurnsInputSchema>
export type ChatsGetTurnEventsInput = z.infer<
  typeof chatsGetTurnEventsInputSchema
>
export type ChatsSendMessageInput = z.infer<typeof chatsSendMessageInputSchema>
export type ChatsApprovePlanInput = z.infer<typeof chatsApprovePlanInputSchema>
export type ChatsApproveSpecsInput = z.infer<
  typeof chatsApproveSpecsInputSchema
>
export type ChatsRenameInput = z.infer<typeof chatsRenameInputSchema>
export type ChatsListResult = z.infer<typeof chatsListResultSchema>
export type ChatsGetMessagesResult = z.infer<
  typeof chatsGetMessagesResultSchema
>
export type ChatsStartTurnResult = z.infer<typeof chatsStartTurnResultSchema>
export type ChatsListTurnsResult = z.infer<typeof chatsListTurnsResultSchema>
export type ChatsGetTurnEventsResult = z.infer<
  typeof chatsGetTurnEventsResultSchema
>
export type ChatsSendMessageResult = z.infer<
  typeof chatsSendMessageResultSchema
>
export type ChatsMessagesSubscribeInput = z.infer<
  typeof chatsMessagesSubscribeInputSchema
>
export type ChatsMessagesEvent = z.infer<typeof chatsMessagesEventSchema>
export type ChatsTurnEventsSubscribeInput = z.infer<
  typeof chatsTurnEventsSubscribeInputSchema
>
export type ChatsTurnEventsEvent = z.infer<typeof chatsTurnEventsEventSchema>

export function parseChatSnapshot(input: unknown): ChatSnapshot {
  return chatSnapshotSchema.parse(input)
}

export function parseChatMessageSnapshot(input: unknown): ChatMessageSnapshot {
  return chatMessageSnapshotSchema.parse(input)
}

export function parseChatTurnSnapshot(input: unknown): ChatTurnSnapshot {
  return chatTurnSnapshotSchema.parse(input)
}

export function parseChatTurnEventSnapshot(
  input: unknown,
): ChatTurnEventSnapshot {
  return chatTurnEventSnapshotSchema.parse(input)
}

export function parseChatsListResult(input: unknown): ChatsListResult {
  return chatsListResultSchema.parse(input)
}

export function parseChatsGetMessagesResult(
  input: unknown,
): ChatsGetMessagesResult {
  return chatsGetMessagesResultSchema.parse(input)
}

export function parseChatsStartTurnResult(
  input: unknown,
): ChatsStartTurnResult {
  return chatsStartTurnResultSchema.parse(input)
}

export function parseChatsListTurnsResult(
  input: unknown,
): ChatsListTurnsResult {
  return chatsListTurnsResultSchema.parse(input)
}

export function parseChatsGetTurnEventsResult(
  input: unknown,
): ChatsGetTurnEventsResult {
  return chatsGetTurnEventsResultSchema.parse(input)
}

export function parseChatsSendMessageResult(
  input: unknown,
): ChatsSendMessageResult {
  return chatsSendMessageResultSchema.parse(input)
}

export function parseChatsMessagesEvent(input: unknown): ChatsMessagesEvent {
  return chatsMessagesEventSchema.parse(input)
}

export function parseChatsTurnEventsEvent(
  input: unknown,
): ChatsTurnEventsEvent {
  return chatsTurnEventsEventSchema.parse(input)
}
