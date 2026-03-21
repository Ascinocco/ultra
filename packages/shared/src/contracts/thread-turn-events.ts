import { z } from "zod"
import { threadIdSchema } from "./threads.js"
import { subscriptionEventEnvelopeSchema } from "./ipc.js"

export const threadTurnEventSnapshotSchema = z.object({
  threadId: threadIdSchema,
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
})

export type ThreadTurnEventSnapshot = z.infer<typeof threadTurnEventSnapshotSchema>

export const threadsTurnEventsSubscribeInputSchema = z.object({
  thread_id: threadIdSchema,
})

export const threadsTurnEventsEventSchema = subscriptionEventEnvelopeSchema.extend({
  event_name: z.literal("threads.turn_events"),
  payload: threadTurnEventSnapshotSchema,
})

export function parseThreadsTurnEventsEvent(raw: unknown): z.infer<typeof threadsTurnEventsEventSchema> {
  return threadsTurnEventsEventSchema.parse(raw)
}
