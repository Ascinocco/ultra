import { z } from "zod"

import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import {
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
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

export const chatsListResultSchema = z.object({
  chats: z.array(chatSummarySchema),
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

export type ChatId = z.infer<typeof chatIdSchema>
export type ChatSnapshot = z.infer<typeof chatSnapshotSchema>
export type ChatSummary = z.infer<typeof chatSummarySchema>
export type ChatSessionSnapshot = z.infer<typeof chatSessionSnapshotSchema>
export type ChatsCreateInput = z.infer<typeof chatsCreateInputSchema>
export type ChatsGetInput = z.infer<typeof chatsGetInputSchema>
export type ChatsListInput = z.infer<typeof chatsListInputSchema>
export type ChatsRenameInput = z.infer<typeof chatsRenameInputSchema>
export type ChatsListResult = z.infer<typeof chatsListResultSchema>

export function parseChatSnapshot(input: unknown): ChatSnapshot {
  return chatSnapshotSchema.parse(input)
}

export function parseChatsListResult(input: unknown): ChatsListResult {
  return chatsListResultSchema.parse(input)
}
