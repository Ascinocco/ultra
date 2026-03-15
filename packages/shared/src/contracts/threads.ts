import { z } from "zod"
import { chatIdSchema } from "./chats.js"
import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import {
  commandRequestEnvelopeSchema,
  queryRequestEnvelopeSchema,
  successResponseEnvelopeSchema,
} from "./ipc.js"
import { projectIdSchema } from "./projects.js"

export const threadIdSchema = opaqueIdSchema
export const threadExecutionStateSchema = z.enum([
  "queued",
  "starting",
  "running",
  "blocked",
  "awaiting_review",
  "finishing",
  "completed",
  "failed",
  "canceled",
])
export const threadReviewStateSchema = z.enum([
  "not_ready",
  "ready",
  "in_review",
  "changes_requested",
  "approved",
])
export const threadPublishStateSchema = z.enum([
  "not_requested",
  "ready_to_publish",
  "publishing",
  "published",
  "publish_failed",
])
export const threadEventPayloadSchema = z.record(z.string(), z.unknown())
export const threadEventCreationSourceSchema = z.enum([
  "start_thread",
  "promotion",
])

export const threadSpecRefSnapshotSchema = z.object({
  threadId: threadIdSchema,
  specPath: z.string().min(1),
  specSlug: z.string().min(1),
  createdAt: isoUtcTimestampSchema,
})

export const threadTicketRefMetadataSchema = z.record(z.string(), z.unknown())
export const threadTicketRefSnapshotSchema = z.object({
  threadId: threadIdSchema,
  provider: z.string().min(1),
  externalId: z.string().min(1),
  displayLabel: z.string().min(1),
  url: z.string().min(1).nullable(),
  metadata: threadTicketRefMetadataSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
})

export const threadSummarySchema = z.object({
  id: threadIdSchema,
  projectId: projectIdSchema,
  sourceChatId: chatIdSchema,
  title: z.string().min(1),
  summary: z.string().nullable(),
  executionState: threadExecutionStateSchema,
  reviewState: threadReviewStateSchema,
  publishState: threadPublishStateSchema,
  backendHealth: z.string().min(1),
  coordinatorHealth: z.string().min(1),
  watchHealth: z.string().min(1),
  ovProjectId: opaqueIdSchema.nullable(),
  ovCoordinatorId: opaqueIdSchema.nullable(),
  ovThreadKey: z.string().nullable(),
  worktreeId: opaqueIdSchema.nullable(),
  branchName: z.string().nullable(),
  baseBranch: z.string().nullable(),
  latestCommitSha: z.string().nullable(),
  prProvider: z.string().nullable(),
  prNumber: z.string().nullable(),
  prUrl: z.string().nullable(),
  lastEventSequence: z.number().int().min(0),
  restartCount: z.number().int().min(0),
  failureReason: z.string().nullable(),
  createdByMessageId: opaqueIdSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  lastActivityAt: isoUtcTimestampSchema.nullable(),
  approvedAt: isoUtcTimestampSchema.nullable(),
  completedAt: isoUtcTimestampSchema.nullable(),
})

export const threadSnapshotSchema = threadSummarySchema

export const threadEventSnapshotSchema = z.object({
  eventId: opaqueIdSchema,
  projectId: projectIdSchema,
  threadId: threadIdSchema,
  sequenceNumber: z.number().int().positive(),
  eventType: z.string().min(1),
  actorType: z.string().min(1),
  actorId: z.string().nullable(),
  source: z.string().min(1),
  payload: threadEventPayloadSchema,
  occurredAt: isoUtcTimestampSchema,
  recordedAt: isoUtcTimestampSchema,
})

export const threadCreatedEventPayloadSchema = z.object({
  sourceChatId: chatIdSchema,
  title: z.string().min(1),
  summary: z.string().nullable(),
  initialSpecIds: z.array(z.string().min(1)),
  initialTicketRefs: z.array(
    threadTicketRefSnapshotSchema.omit({ threadId: true, createdAt: true }),
  ),
  initialExecutionState: threadExecutionStateSchema,
  initialReviewState: threadReviewStateSchema,
  initialPublishState: threadPublishStateSchema,
  creationSource: threadEventCreationSourceSchema,
  promotionSummary: z.string().nullable(),
  carriedMessageIds: z.array(opaqueIdSchema),
  carriedCheckpointIds: z.array(opaqueIdSchema),
  carriedArtifactRefs: z.array(z.string().min(1)),
  carriedSeedRefs: z.array(z.string().min(1)),
})

export const threadSpecRefInputSchema = z.object({
  spec_path: z.string().min(1),
  spec_slug: z.string().min(1),
})

export const threadTicketRefInputSchema = z.object({
  provider: z.string().min(1),
  external_id: z.string().min(1),
  display_label: z.string().min(1),
  url: z.string().min(1).nullable().optional(),
  metadata: threadTicketRefMetadataSchema.nullable().optional(),
})

export const chatsStartThreadInputSchema = z.object({
  chat_id: chatIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1).nullable().optional(),
  plan_approval_message_id: opaqueIdSchema,
  spec_approval_message_id: opaqueIdSchema,
  start_request_message_id: opaqueIdSchema,
  spec_refs: z.array(threadSpecRefInputSchema).default([]),
  ticket_refs: z.array(threadTicketRefInputSchema).default([]),
})

export const chatsPromoteWorkToThreadInputSchema = z.object({
  chat_id: chatIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1).nullable().optional(),
  start_request_message_id: opaqueIdSchema,
  plan_approval_message_id: opaqueIdSchema.nullable().optional(),
  spec_approval_message_id: opaqueIdSchema.nullable().optional(),
  promotion_summary: z.string().min(1),
  selected_message_ids: z.array(opaqueIdSchema).default([]),
  selected_checkpoint_ids: z.array(opaqueIdSchema).default([]),
  carried_artifact_refs: z.array(z.string().min(1)).default([]),
  carried_seed_refs: z.array(z.string().min(1)).default([]),
  spec_refs: z.array(threadSpecRefInputSchema).default([]),
  ticket_refs: z.array(threadTicketRefInputSchema).default([]),
})

export const threadsListByProjectInputSchema = z.object({
  project_id: projectIdSchema,
})

export const threadsListByChatInputSchema = z.object({
  chat_id: chatIdSchema,
})

export const threadsGetInputSchema = z.object({
  thread_id: threadIdSchema,
})

export const threadsGetEventsInputSchema = z.object({
  thread_id: threadIdSchema,
  from_sequence: z.number().int().positive().optional(),
})

export const threadDetailResultSchema = z.object({
  thread: threadSnapshotSchema,
  specRefs: z.array(threadSpecRefSnapshotSchema),
  ticketRefs: z.array(threadTicketRefSnapshotSchema),
})

export const threadsListResultSchema = z.object({
  threads: z.array(threadSummarySchema),
})

export const threadsGetEventsResultSchema = z.object({
  events: z.array(threadEventSnapshotSchema),
})

export const chatsStartThreadCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("chats.start_thread"),
    payload: chatsStartThreadInputSchema,
  })

export const chatsPromoteWorkToThreadCommandSchema =
  commandRequestEnvelopeSchema.extend({
    name: z.literal("chats.promote_work_to_thread"),
    payload: chatsPromoteWorkToThreadInputSchema,
  })

export const threadsListByProjectQuerySchema =
  queryRequestEnvelopeSchema.extend({
    name: z.literal("threads.list_by_project"),
    payload: threadsListByProjectInputSchema,
  })

export const threadsListByChatQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("threads.list_by_chat"),
  payload: threadsListByChatInputSchema,
})

export const threadsGetQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("threads.get"),
  payload: threadsGetInputSchema,
})

export const threadsGetEventsQuerySchema = queryRequestEnvelopeSchema.extend({
  name: z.literal("threads.get_events"),
  payload: threadsGetEventsInputSchema,
})

export const chatsStartThreadSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: threadDetailResultSchema,
  })

export const chatsPromoteWorkToThreadSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: threadDetailResultSchema,
  })

export const threadsListByProjectSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: threadsListResultSchema,
  })

export const threadsListByChatSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: threadsListResultSchema,
  })

export const threadsGetSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: threadDetailResultSchema,
  })

export const threadsGetEventsSuccessResponseSchema =
  successResponseEnvelopeSchema.extend({
    result: threadsGetEventsResultSchema,
  })

export type ThreadId = z.infer<typeof threadIdSchema>
export type ThreadExecutionState = z.infer<typeof threadExecutionStateSchema>
export type ThreadReviewState = z.infer<typeof threadReviewStateSchema>
export type ThreadPublishState = z.infer<typeof threadPublishStateSchema>
export type ThreadEventCreationSource = z.infer<
  typeof threadEventCreationSourceSchema
>
export type ThreadSpecRefSnapshot = z.infer<typeof threadSpecRefSnapshotSchema>
export type ThreadTicketRefSnapshot = z.infer<
  typeof threadTicketRefSnapshotSchema
>
export type ThreadSummary = z.infer<typeof threadSummarySchema>
export type ThreadSnapshot = z.infer<typeof threadSnapshotSchema>
export type ThreadEventSnapshot = z.infer<typeof threadEventSnapshotSchema>
export type ThreadCreatedEventPayload = z.infer<
  typeof threadCreatedEventPayloadSchema
>
export type ThreadSpecRefInput = z.infer<typeof threadSpecRefInputSchema>
export type ThreadTicketRefInput = z.infer<typeof threadTicketRefInputSchema>
export type ChatsStartThreadInput = z.infer<typeof chatsStartThreadInputSchema>
export type ChatsPromoteWorkToThreadInput = z.infer<
  typeof chatsPromoteWorkToThreadInputSchema
>
export type ThreadsListByProjectInput = z.infer<
  typeof threadsListByProjectInputSchema
>
export type ThreadsListByChatInput = z.infer<
  typeof threadsListByChatInputSchema
>
export type ThreadsGetInput = z.infer<typeof threadsGetInputSchema>
export type ThreadsGetEventsInput = z.infer<typeof threadsGetEventsInputSchema>
export type ThreadDetailResult = z.infer<typeof threadDetailResultSchema>
export type ThreadsListResult = z.infer<typeof threadsListResultSchema>
export type ThreadsGetEventsResult = z.infer<
  typeof threadsGetEventsResultSchema
>

export function parseThreadSnapshot(input: unknown): ThreadSnapshot {
  return threadSnapshotSchema.parse(input)
}

export function parseThreadEventSnapshot(input: unknown): ThreadEventSnapshot {
  return threadEventSnapshotSchema.parse(input)
}

export function parseThreadCreatedEventPayload(
  input: unknown,
): ThreadCreatedEventPayload {
  return threadCreatedEventPayloadSchema.parse(input)
}

export function parseThreadDetailResult(input: unknown): ThreadDetailResult {
  return threadDetailResultSchema.parse(input)
}

export function parseThreadsListResult(input: unknown): ThreadsListResult {
  return threadsListResultSchema.parse(input)
}

export function parseThreadsGetEventsResult(
  input: unknown,
): ThreadsGetEventsResult {
  return threadsGetEventsResultSchema.parse(input)
}
