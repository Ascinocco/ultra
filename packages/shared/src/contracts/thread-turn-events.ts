import { z } from "zod"
import { opaqueIdSchema } from "./constants.js"
import { subscriptionEventEnvelopeSchema } from "./ipc.js"

// Use opaqueIdSchema directly to avoid circular dependency with threads.ts
// (threads.ts re-exports from this file)
const threadIdRef = opaqueIdSchema

export const threadTurnEventSnapshotSchema = z.object({
  threadId: threadIdRef,
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
})

export type ThreadTurnEventSnapshot = z.infer<typeof threadTurnEventSnapshotSchema>

export const threadsTurnEventsSubscribeInputSchema = z.object({
  thread_id: threadIdRef,
})

export const threadsTurnEventsEventSchema = subscriptionEventEnvelopeSchema.extend({
  event_name: z.literal("threads.turn_events"),
  payload: threadTurnEventSnapshotSchema,
})

export function parseThreadsTurnEventsEvent(raw: unknown): z.infer<typeof threadsTurnEventsEventSchema> {
  return threadsTurnEventsEventSchema.parse(raw)
}
