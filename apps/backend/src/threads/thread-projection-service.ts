import type { DatabaseSync } from "node:sqlite"
import {
  parseThreadCreatedEventPayload,
  type ThreadEventSnapshot,
} from "@ultra/shared"

export class ThreadProjectionService {
  constructor(private readonly database: DatabaseSync) {}

  applyEvent(event: ThreadEventSnapshot): void {
    switch (event.eventType) {
      case "thread.created":
        this.applyThreadCreated(event)
        return
      default:
        this.database
          .prepare(
            `
              UPDATE threads
              SET
                last_event_sequence = ?,
                updated_at = ?,
                last_activity_at = ?
              WHERE id = ?
            `,
          )
          .run(
            event.sequenceNumber,
            event.recordedAt,
            event.occurredAt,
            event.threadId,
          )
    }
  }

  private applyThreadCreated(event: ThreadEventSnapshot): void {
    const payload = parseThreadCreatedEventPayload(event.payload)

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            title = ?,
            summary = ?,
            execution_state = ?,
            review_state = ?,
            publish_state = ?,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        payload.title,
        payload.summary,
        payload.initialExecutionState,
        payload.initialReviewState,
        payload.initialPublishState,
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }
}
