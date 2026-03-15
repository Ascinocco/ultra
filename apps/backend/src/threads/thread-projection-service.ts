import type { DatabaseSync } from "node:sqlite"
import type { ThreadEventSnapshot } from "@ultra/shared"
import { parseThreadCreatedEventPayload } from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"

export class ThreadProjectionService {
  constructor(private readonly database: DatabaseSync) {}

  applyEvent(event: ThreadEventSnapshot): void {
    if (event.eventType === "thread.created") {
      const payload = parseThreadCreatedEventPayload(event.payload)
      const result = this.database
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

      if (result.changes === 0) {
        throw new IpcProtocolError(
          "internal_error",
          `Thread projection target not found: ${event.threadId}`,
        )
      }

      return
    }

    const result = this.database
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

    if (result.changes === 0) {
      throw new IpcProtocolError(
        "internal_error",
        `Thread projection target not found: ${event.threadId}`,
      )
    }
  }
}
