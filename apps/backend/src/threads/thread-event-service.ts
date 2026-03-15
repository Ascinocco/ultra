import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type { ThreadEventSnapshot } from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"

type ThreadRow = {
  id: string
  project_id: string
}

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
  projectId: string
  threadId: string
  eventType: string
  actorType: string
  actorId?: string | null
  source: string
  payload: unknown
  occurredAt?: string
}

function parsePayload(payloadJson: string, eventId: string): unknown {
  try {
    return JSON.parse(payloadJson)
  } catch (error) {
    throw new IpcProtocolError(
      "internal_error",
      `Thread event payload is invalid JSON: ${eventId}`,
      {
        details: error instanceof Error ? error.message : String(error),
      },
    )
  }
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
    payload: parsePayload(row.payload_json, row.event_id),
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  }
}

export class ThreadEventService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  append(input: AppendThreadEventInput): ThreadEventSnapshot {
    const thread = this.database
      .prepare(
        `
          SELECT id, project_id
          FROM threads
          WHERE id = ?
        `,
      )
      .get(input.threadId) as ThreadRow | undefined

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

    const eventId = `thread_event_${randomUUID()}`
    const recordedAt = this.now()
    const occurredAt = input.occurredAt ?? recordedAt

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
        recordedAt,
      )

    const row = this.database
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
      .get(eventId) as ThreadEventRow | undefined

    if (!row) {
      throw new IpcProtocolError(
        "internal_error",
        `Thread event could not be loaded after insert: ${eventId}`,
      )
    }

    return mapThreadEventRow(row)
  }

  listEvents(threadId: string, fromSequence = 0): ThreadEventSnapshot[] {
    return this.database
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
            AND sequence_number > ?
          ORDER BY sequence_number ASC
        `,
      )
      .all(threadId, fromSequence)
      .map((row) => mapThreadEventRow(row as ThreadEventRow))
  }
}
