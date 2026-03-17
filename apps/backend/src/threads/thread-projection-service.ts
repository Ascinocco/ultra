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
      case "thread.execution_state_changed":
        this.applyExecutionStateChanged(event)
        return
      case "thread.blocked":
        this.applyBlocked(event)
        return
      case "thread.review_ready":
        this.applyReviewReady(event)
        return
      case "thread.review_state_changed":
        this.applyReviewStateChanged(event)
        return
      case "thread.publish_state_changed":
        this.applyPublishStateChanged(event)
        return
      case "thread.failed":
        this.applyFailed(event)
        return
      case "thread.completed":
        this.applyCompleted(event)
        return
      case "thread.health_changed":
        this.applyHealthChanged(event)
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

  private applyExecutionStateChanged(event: ThreadEventSnapshot): void {
    const payload = event.payload as {
      reason?: unknown
      to_state?: unknown
    }
    const nextState =
      typeof payload.to_state === "string" ? payload.to_state : "running"
    const failureReason =
      nextState === "failed" && typeof payload.reason === "string"
        ? payload.reason
        : null

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            execution_state = ?,
            failure_reason = ?,
            completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        nextState,
        failureReason,
        nextState,
        event.occurredAt,
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }

  private applyBlocked(event: ThreadEventSnapshot): void {
    const payload = event.payload as {
      blocked_reason?: unknown
    }

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            execution_state = 'blocked',
            failure_reason = ?,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        typeof payload.blocked_reason === "string"
          ? payload.blocked_reason
          : "Thread blocked.",
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }

  private applyReviewReady(event: ThreadEventSnapshot): void {
    const payload = event.payload as {
      base_branch?: unknown
      branch_name?: unknown
      commit_id?: unknown
    }

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            execution_state = 'awaiting_review',
            review_state = 'ready',
            branch_name = ?,
            base_branch = ?,
            latest_commit_sha = ?,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        typeof payload.branch_name === "string" ? payload.branch_name : null,
        typeof payload.base_branch === "string" ? payload.base_branch : null,
        typeof payload.commit_id === "string" ? payload.commit_id : null,
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }

  private applyReviewStateChanged(event: ThreadEventSnapshot): void {
    const payload = event.payload as {
      to_state?: unknown
    }

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            review_state = ?,
            approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        typeof payload.to_state === "string" ? payload.to_state : "not_ready",
        typeof payload.to_state === "string" ? payload.to_state : "not_ready",
        event.occurredAt,
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }

  private applyPublishStateChanged(event: ThreadEventSnapshot): void {
    const payload = event.payload as {
      to_state?: unknown
    }

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            publish_state = ?,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        typeof payload.to_state === "string"
          ? payload.to_state
          : "not_requested",
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }

  private applyFailed(event: ThreadEventSnapshot): void {
    const payload = event.payload as {
      error_message?: unknown
      message?: unknown
      reason?: unknown
    }
    const reason =
      typeof payload.reason === "string"
        ? payload.reason
        : typeof payload.message === "string"
          ? payload.message
          : typeof payload.error_message === "string"
            ? payload.error_message
            : "Thread execution failed."

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            execution_state = 'failed',
            failure_reason = ?,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        reason,
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }

  private applyCompleted(event: ThreadEventSnapshot): void {
    this.database
      .prepare(
        `
          UPDATE threads
          SET
            execution_state = 'completed',
            completed_at = ?,
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        event.occurredAt,
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }

  private applyHealthChanged(event: ThreadEventSnapshot): void {
    const payload = event.payload as {
      coordinator_health?: unknown
      reason?: unknown
      watch_health?: unknown
    }

    this.database
      .prepare(
        `
          UPDATE threads
          SET
            coordinator_health = COALESCE(?, coordinator_health),
            watch_health = COALESCE(?, watch_health),
            failure_reason = COALESCE(?, failure_reason),
            last_event_sequence = ?,
            updated_at = ?,
            last_activity_at = ?
          WHERE id = ?
        `,
      )
      .run(
        typeof payload.coordinator_health === "string"
          ? payload.coordinator_health
          : null,
        typeof payload.watch_health === "string" ? payload.watch_health : null,
        typeof payload.reason === "string" ? payload.reason : null,
        event.sequenceNumber,
        event.recordedAt,
        event.occurredAt,
        event.threadId,
      )
  }
}
