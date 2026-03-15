import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type { ProjectId, ThreadEventSnapshot, ThreadId } from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"

type ThreadEventRow = {
  event_id: string
  project_id: string
  thread_id: string
  sequence_number: number
  event_type: string
  actor_type: string
  actor_id: string | null
  source: string
  payload_json: string
  occurred_at: string
  recorded_at: string
}

export type AppendThreadEventInput = {
  projectId: ProjectId
  threadId: ThreadId
  eventType: string
  actorType: string
  actorId?: string | null
  source: string
  payload: Record<string, unknown>
  occurredAt?: string
}

function readThreadEventRow(result: unknown): ThreadEventRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ThreadEventRow
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadJson) as unknown

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Thread event payload JSON must decode to an object.")
  }

  return parsed as Record<string, unknown>
}

function mapThreadEventRow(row: ThreadEventRow): ThreadEventSnapshot {
  return {
    eventId: row.event_id,
    projectId: row.project_id,
    threadId: row.thread_id,
    sequenceNumber: row.sequence_number,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    source: row.source,
    payload: parsePayload(row.payload_json),
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  }
}

export class ThreadEventService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  appendEvent(input: AppendThreadEventInput): ThreadEventSnapshot {
    const thread = this.database
      .prepare("SELECT id, project_id FROM threads WHERE id = ?")
      .get(input.threadId) as { id: string; project_id: string } | undefined

    if (!thread) {
      throw new IpcProtocolError(
        "not_found",
        `Thread not found: ${input.threadId}`,
      )
    }

    if (thread.project_id !== input.projectId) {
      throw new IpcProtocolError(
        "invalid_request",
        `Thread ${input.threadId} does not belong to project ${input.projectId}.`,
      )
    }

    const nextSequenceRow = this.database
      .prepare(
        `
          SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
          FROM thread_events
          WHERE thread_id = ?
        `,
      )
      .get(input.threadId) as { next_sequence: number }

    const timestamp = this.now()
    const occurredAt = input.occurredAt ?? timestamp
    const eventId = `thread_event_${randomUUID()}`

    this.database
      .prepare(
        `
          INSERT INTO thread_events (
            event_id,
            project_id,
            thread_id,
            sequence_number,
            event_type,
            actor_type,
            actor_id,
            source,
            payload_json,
            occurred_at,
            recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        eventId,
        input.projectId,
        input.threadId,
        nextSequenceRow.next_sequence,
        input.eventType,
        input.actorType,
        input.actorId ?? null,
        input.source,
        JSON.stringify(input.payload),
        occurredAt,
        timestamp,
      )

    return this.getEvent(eventId)
  }

  getEvent(eventId: string): ThreadEventSnapshot {
    const row = readThreadEventRow(
      this.database
        .prepare(
          `
            SELECT
              event_id,
              project_id,
              thread_id,
              sequence_number,
              event_type,
              actor_type,
              actor_id,
              source,
              payload_json,
              occurred_at,
              recorded_at
            FROM thread_events
            WHERE event_id = ?
          `,
        )
        .get(eventId),
    )

    if (!row) {
      throw new IpcProtocolError(
        "not_found",
        `Thread event not found: ${eventId}`,
      )
    }

    return mapThreadEventRow(row)
  }

  listEvents(threadId: ThreadId, fromSequence?: number): ThreadEventSnapshot[] {
    const thread = this.database
      .prepare("SELECT id FROM threads WHERE id = ?")
      .get(threadId)

    if (!thread) {
      throw new IpcProtocolError("not_found", `Thread not found: ${threadId}`)
    }

    const rows = (
      fromSequence
        ? this.database
            .prepare(
              `
                SELECT
                  event_id,
                  project_id,
                  thread_id,
                  sequence_number,
                  event_type,
                  actor_type,
                  actor_id,
                  source,
                  payload_json,
                  occurred_at,
                  recorded_at
                FROM thread_events
                WHERE thread_id = ? AND sequence_number > ?
                ORDER BY sequence_number ASC
              `,
            )
            .all(threadId, fromSequence)
        : this.database
            .prepare(
              `
                SELECT
                  event_id,
                  project_id,
                  thread_id,
                  sequence_number,
                  event_type,
                  actor_type,
                  actor_id,
                  source,
                  payload_json,
                  occurred_at,
                  recorded_at
                FROM thread_events
                WHERE thread_id = ?
                ORDER BY sequence_number ASC
              `,
            )
            .all(threadId)
    ) as ThreadEventRow[]

    return rows.map((row) => mapThreadEventRow(row))
  }
}
