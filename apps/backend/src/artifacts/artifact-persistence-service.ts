import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type {
  ArtifactSnapshot,
  ArtifactStoredBundle,
  ArtifactType,
  ProjectId,
  ThreadId,
} from "@ultra/shared"
import { parseArtifactStoredBundle } from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"

type ArtifactRow = {
  artifact_id: string
  project_id: string
  thread_id: string
  artifact_type: ArtifactType
  title: string
  path: string | null
  metadata_json: string
  created_at: string
}

export type CreateArtifactInput = {
  artifactId?: string
  projectId: ProjectId
  threadId: ThreadId
  artifactType: ArtifactType
  title: string
  path?: string | null
  metadata: ArtifactStoredBundle
  createdAt?: string
}

function readArtifactRow(result: unknown): ArtifactRow | null {
  if (!result || typeof result !== "object") {
    return null
  }

  return result as ArtifactRow
}

function parseArtifactMetadata(metadataJson: string): ArtifactStoredBundle {
  return parseArtifactStoredBundle(JSON.parse(metadataJson) as unknown)
}

function mapArtifactRow(row: ArtifactRow): ArtifactSnapshot {
  return {
    artifactId: row.artifact_id,
    projectId: row.project_id,
    threadId: row.thread_id,
    artifactType: row.artifact_type,
    title: row.title,
    path: row.path,
    metadata: parseArtifactMetadata(row.metadata_json),
    createdAt: row.created_at,
  }
}

export class ArtifactPersistenceService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly idFactory: () => string = () => `artifact_${randomUUID()}`,
  ) {}

  createArtifact(input: CreateArtifactInput): ArtifactSnapshot {
    this.assertThreadBelongsToProject(input.projectId, input.threadId)

    const artifactId = input.artifactId ?? this.idFactory()
    const createdAt = input.createdAt ?? this.now()

    this.database
      .prepare(
        `
          INSERT INTO artifacts (
            artifact_id,
            project_id,
            thread_id,
            artifact_type,
            title,
            path,
            metadata_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        artifactId,
        input.projectId,
        input.threadId,
        input.artifactType,
        input.title,
        input.path ?? null,
        JSON.stringify(input.metadata),
        createdAt,
      )

    return this.getArtifactOrThrow(artifactId)
  }

  getArtifact(artifactId: string): ArtifactSnapshot | null {
    const row = readArtifactRow(
      this.database
        .prepare(
          `
            SELECT
              artifact_id,
              project_id,
              thread_id,
              artifact_type,
              title,
              path,
              metadata_json,
              created_at
            FROM artifacts
            WHERE artifact_id = ?
          `,
        )
        .get(artifactId),
    )

    return row ? mapArtifactRow(row) : null
  }

  listArtifactsForThread(threadId: ThreadId): ArtifactSnapshot[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            artifact_id,
            project_id,
            thread_id,
            artifact_type,
            title,
            path,
            metadata_json,
            created_at
          FROM artifacts
          WHERE thread_id = ?
          ORDER BY created_at DESC, artifact_id DESC
        `,
      )
      .all(threadId) as ArtifactRow[]

    return rows.map(mapArtifactRow)
  }

  private getArtifactOrThrow(artifactId: string): ArtifactSnapshot {
    const artifact = this.getArtifact(artifactId)

    if (!artifact) {
      throw new IpcProtocolError(
        "not_found",
        `Artifact '${artifactId}' was not found after insertion.`,
      )
    }

    return artifact
  }

  private assertThreadBelongsToProject(
    projectId: ProjectId,
    threadId: ThreadId,
  ): void {
    const row = this.database
      .prepare("SELECT id FROM threads WHERE id = ? AND project_id = ?")
      .get(threadId, projectId) as { id: string } | undefined

    if (!row) {
      throw new IpcProtocolError(
        "not_found",
        `Thread '${threadId}' was not found for project '${projectId}'.`,
      )
    }
  }
}
