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

export const chatsListResultSchema = z.object({
  chats: z.array(chatSummarySchema),
})

export const chatsGetMessagesResultSchema = z.object({
  messages: z.array(chatMessageSnapshotSchema),
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
})

export const chatsGetMessagesInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsRenameInputSchema = z.object({
  chat_id: chatIdSchema,
  title: z.string().min(1),
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

export const chatsApprovePlanInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsApproveSpecsInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const chatsCreateCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.create"),
  payload: chatsCreateInputSchema,
})

export const chatsRenameCommandSchema = commandRequestEnvelopeSchema.extend({
  name: z.literal("chats.rename"),
  payload: chatsRenameInputSchema,
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

export const chatsMessagesSubscribeRequestSchema =
  subscribeRequestEnvelopeSchema.extend({
    name: z.literal("chats.messages"),
    payload: chatsMessagesSubscribeInputSchema,
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

export type ChatId = z.infer<typeof chatIdSchema>
export type ChatSnapshot = z.infer<typeof chatSnapshotSchema>
export type ChatSummary = z.infer<typeof chatSummarySchema>
export type ChatSessionSnapshot = z.infer<typeof chatSessionSnapshotSchema>
export type ChatMessageSnapshot = z.infer<typeof chatMessageSnapshotSchema>
export type ChatsCreateInput = z.infer<typeof chatsCreateInputSchema>
export type ChatsGetInput = z.infer<typeof chatsGetInputSchema>
export type ChatsListInput = z.infer<typeof chatsListInputSchema>
export type ChatsGetMessagesInput = z.infer<typeof chatsGetMessagesInputSchema>
export type ChatsSendMessageInput = z.infer<typeof chatsSendMessageInputSchema>
export type ChatsApprovePlanInput = z.infer<typeof chatsApprovePlanInputSchema>
export type ChatsApproveSpecsInput = z.infer<
  typeof chatsApproveSpecsInputSchema
>
export type ChatsRenameInput = z.infer<typeof chatsRenameInputSchema>
export type ChatsListResult = z.infer<typeof chatsListResultSchema>
export type ChatsGetMessagesResult = z.infer<typeof chatsGetMessagesResultSchema>
export type ChatsSendMessageResult = z.infer<typeof chatsSendMessageResultSchema>
export type ChatsMessagesSubscribeInput = z.infer<
  typeof chatsMessagesSubscribeInputSchema
>
export type ChatsMessagesEvent = z.infer<typeof chatsMessagesEventSchema>

export function parseChatSnapshot(input: unknown): ChatSnapshot {
  return chatSnapshotSchema.parse(input)
}

export function parseChatMessageSnapshot(input: unknown): ChatMessageSnapshot {
  return chatMessageSnapshotSchema.parse(input)
}

export function parseChatsListResult(input: unknown): ChatsListResult {
  return chatsListResultSchema.parse(input)
}

export function parseChatsGetMessagesResult(
  input: unknown,
): ChatsGetMessagesResult {
  return chatsGetMessagesResultSchema.parse(input)
}

export function parseChatsSendMessageResult(
  input: unknown,
): ChatsSendMessageResult {
  return chatsSendMessageResultSchema.parse(input)
}

export function parseChatsMessagesEvent(input: unknown): ChatsMessagesEvent {
  return chatsMessagesEventSchema.parse(input)
}
