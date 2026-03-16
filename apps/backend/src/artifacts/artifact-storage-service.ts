import { randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import type {
  ArtifactBundle,
  ArtifactLargeContentRef,
  ArtifactLoadResult,
  ArtifactSnapshot,
  ArtifactStoredBundle,
  ArtifactStoreInput,
} from "@ultra/shared"
import {
  parseArtifactBundle,
  parseArtifactLoadResult,
  parseArtifactStoreInput,
} from "@ultra/shared"

import type { ArtifactPersistenceService } from "./artifact-persistence-service.js"

export const DEFAULT_ARTIFACT_INLINE_CONTENT_BYTES = 16 * 1024
const SPILLABLE_FIELD_NAMES = new Set([
  "terminalOutput",
  "debugOutput",
  "output",
  "consoleEntries",
  "networkSummary",
  "selectedDomSnippet",
])

type SpillFile = {
  logicalKey: string
  relativePath: string
  absolutePath: string
  content: string
}

type NormalizeBundleResult = {
  storedBundle: ArtifactStoredBundle
  spillFiles: SpillFile[]
}

type ArtifactStorageErrorCode =
  | "invalid_input"
  | "invalid_stored_bundle"
  | "missing_spilled_content"

export class ArtifactStorageError extends Error {
  constructor(
    readonly code: ArtifactStorageErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "ArtifactStorageError"
  }
}

export function deriveArtifactStorageRoot(databasePath: string): string {
  return join(dirname(resolve(databasePath)), "artifacts")
}

export class ArtifactStorageService {
  private readonly storageRoot: string

  constructor(
    private readonly persistenceService: ArtifactPersistenceService,
    databasePath: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly idFactory: () => string = () => `artifact_${randomUUID()}`,
    private readonly inlineThresholdBytes: number = DEFAULT_ARTIFACT_INLINE_CONTENT_BYTES,
  ) {
    this.storageRoot = deriveArtifactStorageRoot(databasePath)
  }

  getArtifact(artifactId: string): ArtifactSnapshot | null {
    return this.persistenceService.getArtifact(artifactId)
  }

  listArtifactsForThread(threadId: string): ArtifactSnapshot[] {
    return this.persistenceService.listArtifactsForThread(threadId)
  }

  storeArtifact(rawInput: ArtifactStoreInput): ArtifactSnapshot {
    const input = parseArtifactStoreInput(rawInput)

    if (input.bundle.largeContentRefs.length > 0) {
      throw new ArtifactStorageError(
        "invalid_input",
        "Artifact storage only accepts inline bundle content.",
      )
    }

    const artifactId = this.idFactory()
    const createdAt = this.now()
    const artifactRelativePath = join(
      input.projectId,
      input.threadId,
      artifactId,
    )
    const artifactDirectory = join(this.storageRoot, artifactRelativePath)
    const stagingDirectory = `${artifactDirectory}.tmp-${randomUUID()}`
    const normalized = this.normalizeBundle(input.bundle, artifactRelativePath)
    let promotedArtifactDirectory = false

    try {
      if (normalized.spillFiles.length > 0) {
        mkdirSync(stagingDirectory, { recursive: true })

        for (const spillFile of normalized.spillFiles) {
          this.writeAtomicTextFile(
            spillFile.absolutePath.replace(artifactDirectory, stagingDirectory),
            spillFile.content,
          )
        }

        renameSync(stagingDirectory, artifactDirectory)
        promotedArtifactDirectory = true
      }

      return this.persistenceService.createArtifact({
        artifactId,
        projectId: input.projectId,
        threadId: input.threadId,
        artifactType: input.bundle.artifactType,
        title: input.bundle.title,
        path: normalized.spillFiles.length > 0 ? artifactRelativePath : null,
        metadata: normalized.storedBundle,
        createdAt,
      })
    } catch (error) {
      rmSync(stagingDirectory, { recursive: true, force: true })

      if (promotedArtifactDirectory) {
        rmSync(artifactDirectory, { recursive: true, force: true })
      }

      throw error
    }
  }

  loadArtifactBundle(artifactId: string): ArtifactLoadResult | null {
    const artifact = this.persistenceService.getArtifact(artifactId)

    if (!artifact) {
      return null
    }

    const hydratedPayload = cloneJsonValue(artifact.metadata.payload)

    for (const ref of artifact.metadata.largeContentRefs) {
      if (!artifact.path) {
        throw new ArtifactStorageError(
          "invalid_stored_bundle",
          `Artifact '${artifact.artifactId}' is missing a base path for spilled content.`,
          {
            artifactId: artifact.artifactId,
            logicalKey: ref.logicalKey,
          },
        )
      }

      const absolutePath = join(
        this.storageRoot,
        artifact.path,
        ref.relativePath,
      )

      if (!existsSync(absolutePath)) {
        throw new ArtifactStorageError(
          "missing_spilled_content",
          `Artifact '${artifact.artifactId}' is missing spilled content for '${ref.logicalKey}'.`,
          {
            artifactId: artifact.artifactId,
            logicalKey: ref.logicalKey,
            relativePath: ref.relativePath,
          },
        )
      }

      setNestedValue(
        hydratedPayload,
        ref.logicalKey.split("."),
        readFileSync(absolutePath, "utf8"),
      )
    }

    return parseArtifactLoadResult({
      artifact,
      bundle: parseArtifactBundle({
        artifactType: artifact.metadata.artifactType,
        title: artifact.metadata.title,
        summary: artifact.metadata.summary,
        capturedAt: artifact.metadata.capturedAt,
        source: artifact.metadata.source,
        payload: hydratedPayload,
        largeContentRefs: artifact.metadata.largeContentRefs,
      }),
    })
  }

  private normalizeBundle(
    bundle: ArtifactBundle,
    artifactRelativePath: string,
  ): NormalizeBundleResult {
    const payload = cloneJsonValue(bundle.payload)
    const spillFiles: SpillFile[] = []
    const largeContentRefs: ArtifactLargeContentRef[] = []

    this.collectLargeStrings({
      artifactRelativePath,
      keyPath: [],
      largeContentRefs,
      spillFiles,
      value: payload,
    })

    return {
      storedBundle: {
        artifactType: bundle.artifactType,
        title: bundle.title,
        summary: bundle.summary,
        capturedAt: bundle.capturedAt,
        source: bundle.source,
        payload,
        largeContentRefs,
      },
      spillFiles,
    }
  }

  private collectLargeStrings(input: {
    artifactRelativePath: string
    keyPath: string[]
    largeContentRefs: ArtifactLargeContentRef[]
    spillFiles: SpillFile[]
    value: unknown
  }): void {
    if (typeof input.value === "string") {
      const byteSize = Buffer.byteLength(input.value, "utf8")
      const logicalKey = input.keyPath.join(".")

      if (
        byteSize <= this.inlineThresholdBytes ||
        !isSpillableLogicalKey(logicalKey)
      ) {
        return
      }

      const relativePath = `${sanitizeLogicalKey(logicalKey)}.txt`

      input.largeContentRefs.push({
        logicalKey,
        relativePath,
        byteSize,
        contentType: "text/plain; charset=utf-8",
      })
      input.spillFiles.push({
        logicalKey,
        relativePath,
        absolutePath: join(
          this.storageRoot,
          input.artifactRelativePath,
          relativePath,
        ),
        content: input.value,
      })

      return
    }

    if (Array.isArray(input.value)) {
      const values = input.value as unknown[]

      values.forEach((child, index) => {
        if (typeof child === "string") {
          const byteSize = Buffer.byteLength(child, "utf8")
          const logicalKey = [...input.keyPath, String(index)].join(".")

          if (
            byteSize > this.inlineThresholdBytes &&
            isSpillableLogicalKey(logicalKey)
          ) {
            const relativePath = `${sanitizeLogicalKey(logicalKey)}.txt`

            input.largeContentRefs.push({
              logicalKey,
              relativePath,
              byteSize,
              contentType: "text/plain; charset=utf-8",
            })
            input.spillFiles.push({
              logicalKey,
              relativePath,
              absolutePath: join(
                this.storageRoot,
                input.artifactRelativePath,
                relativePath,
              ),
              content: child,
            })
            values[index] = null
          }

          return
        }

        this.collectLargeStrings({
          artifactRelativePath: input.artifactRelativePath,
          keyPath: [...input.keyPath, String(index)],
          largeContentRefs: input.largeContentRefs,
          spillFiles: input.spillFiles,
          value: child,
        })
      })

      return
    }

    if (input.value && typeof input.value === "object") {
      for (const [key, child] of Object.entries(
        input.value as Record<string, unknown>,
      )) {
        if (typeof child === "string") {
          const byteSize = Buffer.byteLength(child, "utf8")
          const logicalKey = [...input.keyPath, key].join(".")

          if (
            byteSize > this.inlineThresholdBytes &&
            isSpillableLogicalKey(logicalKey)
          ) {
            const relativePath = `${sanitizeLogicalKey(logicalKey)}.txt`

            input.largeContentRefs.push({
              logicalKey,
              relativePath,
              byteSize,
              contentType: "text/plain; charset=utf-8",
            })
            input.spillFiles.push({
              logicalKey,
              relativePath,
              absolutePath: join(
                this.storageRoot,
                input.artifactRelativePath,
                relativePath,
              ),
              content: child,
            })
            ;(input.value as Record<string, unknown>)[key] = null
            continue
          }
        }

        this.collectLargeStrings({
          artifactRelativePath: input.artifactRelativePath,
          keyPath: [...input.keyPath, key],
          largeContentRefs: input.largeContentRefs,
          spillFiles: input.spillFiles,
          value: child,
        })
      }
    }
  }

  private writeAtomicTextFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true })
    const temporaryPath = `${path}.tmp-${randomUUID()}`
    const fileDescriptor = openSync(temporaryPath, "w")
    let fileDescriptorClosed = false

    try {
      writeFileSync(fileDescriptor, content, "utf8")
      fsyncSync(fileDescriptor)
      closeSync(fileDescriptor)
      fileDescriptorClosed = true
      renameSync(temporaryPath, path)
    } catch (error) {
      try {
        if (!fileDescriptorClosed) {
          closeSync(fileDescriptor)
        }
      } catch {
        // Ignore close failures during cleanup.
      }
      rmSync(temporaryPath, { force: true })
      throw error
    }
  }
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeLogicalKey(logicalKey: string): string {
  return logicalKey.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

function isSpillableLogicalKey(logicalKey: string): boolean {
  const segment = logicalKey
    .split(".")
    .findLast((part) => Number.isNaN(Number(part)))

  return segment ? SPILLABLE_FIELD_NAMES.has(segment) : false
}

function setNestedValue(
  container: unknown,
  pathSegments: string[],
  value: unknown,
): void {
  if (pathSegments.length === 0) {
    return
  }

  let current = container as Record<string, unknown> | unknown[]

  for (const [index, segment] of pathSegments.entries()) {
    const isLast = index === pathSegments.length - 1
    const arrayIndex = Number(segment)
    const isArraySegment =
      Number.isInteger(arrayIndex) && segment === String(arrayIndex)

    if (isLast) {
      if (Array.isArray(current) && isArraySegment) {
        current[arrayIndex] = value
      } else if (!Array.isArray(current)) {
        current[segment] = value
      }
      return
    }

    const nextSegment = pathSegments[index + 1]
    const nextArrayIndex = Number(nextSegment)
    const nextIsArraySegment =
      Number.isInteger(nextArrayIndex) && nextSegment === String(nextArrayIndex)

    if (Array.isArray(current) && isArraySegment) {
      const existing = current[arrayIndex]

      if (!existing || typeof existing !== "object") {
        current[arrayIndex] = nextIsArraySegment ? [] : {}
      }

      current = current[arrayIndex] as Record<string, unknown> | unknown[]
    } else if (!Array.isArray(current)) {
      const existing = current[segment]

      if (!existing || typeof existing !== "object") {
        current[segment] = nextIsArraySegment ? [] : {}
      }

      current = current[segment] as Record<string, unknown> | unknown[]
    }
  }
}
