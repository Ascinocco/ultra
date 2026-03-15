import type { Stats } from "node:fs"
import { copyFileSync, mkdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import type {
  SandboxContextSnapshot,
  SandboxRuntimeSyncSnapshot,
} from "@ultra/shared"

import type { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import type {
  ResolvedRuntimeFile,
  ResolvedRuntimeProfile,
} from "./runtime-profile-service.js"

type RuntimeSyncDetailsShape = {
  checkedAt: string
  copiedFiles: string[]
  error: string | null
  invalidPaths: string[]
  missingSourceFiles: string[]
  staleFiles: string[]
}

type RuntimeFileCheck = {
  copyError: string | null
  invalidReason: string | null
  runtimeFilePath: string
  samePath: boolean
  sourcePath: string | null
  sourceStat: Stats | null
  stale: boolean
  targetPath: string | null
  targetStat: Stats | null
}

function readStat(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function buildDetails(
  checkedAt: string,
  values: {
    copiedFiles?: string[]
    error?: string | null
    invalidPaths?: string[]
    missingSourceFiles?: string[]
    staleFiles?: string[]
  },
): RuntimeSyncDetailsShape {
  return {
    checkedAt,
    copiedFiles: values.copiedFiles ?? [],
    staleFiles: values.staleFiles ?? [],
    missingSourceFiles: values.missingSourceFiles ?? [],
    invalidPaths: values.invalidPaths ?? [],
    error: values.error ?? null,
  }
}

export class RuntimeSyncService {
  constructor(
    private readonly persistenceService: SandboxPersistenceService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  refreshRuntimeSync(
    sandbox: SandboxContextSnapshot,
    runtimeProfile: ResolvedRuntimeProfile,
  ): SandboxRuntimeSyncSnapshot {
    const persisted = this.persistenceService.getPersistedRuntimeSync(
      sandbox.sandboxId,
    )

    if (!persisted) {
      return this.persistenceService.getRuntimeSync(sandbox.sandboxId)
    }

    const checkedAt = this.now()
    const evaluation = this.evaluateCurrentState(sandbox, runtimeProfile.files)

    if (!evaluation.unsatisfied) {
      return this.persistenceService.upsertRuntimeSync({
        sandboxId: sandbox.sandboxId,
        status: "synced",
        syncedFiles: evaluation.satisfiedFiles,
        ...(persisted.lastSyncedAt
          ? { lastSyncedAt: persisted.lastSyncedAt }
          : {}),
        details: buildDetails(checkedAt, {
          copiedFiles: [],
          staleFiles: [],
          missingSourceFiles: [],
          invalidPaths: [],
        }),
      })
    }

    const status =
      persisted.status === "failed" || evaluation.failed ? "failed" : "stale"

    return this.persistenceService.upsertRuntimeSync({
      sandboxId: sandbox.sandboxId,
      status,
      syncedFiles: evaluation.satisfiedFiles,
      ...(persisted.lastSyncedAt
        ? { lastSyncedAt: persisted.lastSyncedAt }
        : {}),
      details: buildDetails(checkedAt, {
        staleFiles: evaluation.staleFiles,
        missingSourceFiles: evaluation.missingSourceFiles,
        invalidPaths: evaluation.invalidPaths,
        error: evaluation.error,
      }),
    })
  }

  syncRuntimeFiles(
    sandbox: SandboxContextSnapshot,
    runtimeProfile: ResolvedRuntimeProfile,
    force = false,
  ): SandboxRuntimeSyncSnapshot {
    const checkedAt = this.now()
    const sandboxRoot = readStat(sandbox.path)

    if (!sandboxRoot?.isDirectory()) {
      return this.persistenceService.upsertRuntimeSync({
        sandboxId: sandbox.sandboxId,
        status: "failed",
        syncedFiles: [],
        details: buildDetails(checkedAt, {
          error: `Sandbox path is missing or not a directory: ${sandbox.path}`,
        }),
      })
    }

    const checks = runtimeProfile.files.map((file) =>
      this.evaluateRuntimeFile(sandbox, file),
    )
    const invalidPaths = checks
      .filter((check) => check.invalidReason)
      .map((check) => check.runtimeFilePath)
    const missingSourceFiles = checks
      .filter((check) => !check.invalidReason && !check.sourceStat)
      .map((check) => check.runtimeFilePath)
    const copiedFiles: string[] = []

    let copyError: string | null = null

    for (const check of checks) {
      if (
        check.invalidReason ||
        !check.sourceStat ||
        check.samePath ||
        (!check.stale && !force)
      ) {
        continue
      }

      try {
        mkdirSync(dirname(check.targetPath as string), { recursive: true })
        copyFileSync(check.sourcePath as string, check.targetPath as string)
        copiedFiles.push(check.runtimeFilePath)
      } catch (error) {
        copyError = error instanceof Error ? error.message : String(error)
      }
    }

    if (copyError || invalidPaths.length > 0 || missingSourceFiles.length > 0) {
      const postSync = this.evaluateCurrentState(sandbox, runtimeProfile.files)

      return this.persistenceService.upsertRuntimeSync({
        sandboxId: sandbox.sandboxId,
        status: "failed",
        syncedFiles: postSync.satisfiedFiles,
        details: buildDetails(checkedAt, {
          copiedFiles,
          staleFiles: postSync.staleFiles,
          missingSourceFiles,
          invalidPaths,
          error: copyError,
        }),
      })
    }

    const postSync = this.evaluateCurrentState(sandbox, runtimeProfile.files)

    return this.persistenceService.upsertRuntimeSync({
      sandboxId: sandbox.sandboxId,
      status: "synced",
      syncedFiles: postSync.satisfiedFiles,
      lastSyncedAt: checkedAt,
      details: buildDetails(checkedAt, {
        copiedFiles,
      }),
    })
  }

  private evaluateCurrentState(
    sandbox: SandboxContextSnapshot,
    files: ResolvedRuntimeFile[],
  ): {
    error: string | null
    failed: boolean
    invalidPaths: string[]
    missingSourceFiles: string[]
    satisfiedFiles: string[]
    staleFiles: string[]
    unsatisfied: boolean
  } {
    const checks = files.map((file) => this.evaluateRuntimeFile(sandbox, file))
    const invalidPaths = checks
      .filter((check) => check.invalidReason)
      .map((check) => check.runtimeFilePath)
    const missingSourceFiles = checks
      .filter((check) => !check.invalidReason && !check.sourceStat)
      .map((check) => check.runtimeFilePath)
    const staleFiles = checks
      .filter(
        (check) =>
          !check.invalidReason &&
          check.sourceStat &&
          check.stale &&
          !check.samePath,
      )
      .map((check) => check.runtimeFilePath)
    const satisfiedFiles = checks
      .filter(
        (check) =>
          !check.invalidReason &&
          check.sourceStat &&
          (!check.stale || check.samePath),
      )
      .map((check) => check.runtimeFilePath)
    const sandboxRoot = readStat(sandbox.path)
    const sandboxError = sandboxRoot?.isDirectory()
      ? null
      : `Sandbox path is missing or not a directory: ${sandbox.path}`

    return {
      invalidPaths,
      missingSourceFiles,
      staleFiles,
      satisfiedFiles,
      failed:
        sandboxError !== null ||
        invalidPaths.length > 0 ||
        missingSourceFiles.length > 0,
      unsatisfied:
        sandboxError !== null ||
        invalidPaths.length > 0 ||
        missingSourceFiles.length > 0 ||
        staleFiles.length > 0,
      error: sandboxError,
    }
  }

  private evaluateRuntimeFile(
    sandbox: SandboxContextSnapshot,
    file: ResolvedRuntimeFile,
  ): RuntimeFileCheck {
    if (file.invalidReason || !file.normalizedPath || !file.sourcePath) {
      return {
        runtimeFilePath: file.runtimeFilePath,
        invalidReason: file.invalidReason,
        sourcePath: file.sourcePath,
        sourceStat: null,
        targetPath: null,
        targetStat: null,
        stale: false,
        samePath: false,
        copyError: null,
      }
    }

    const targetPath = join(sandbox.path, ...file.normalizedPath.split("/"))
    const sourceStat = readStat(file.sourcePath)
    const targetStat = readStat(targetPath)
    const samePath = file.sourcePath === targetPath
    const stale =
      sourceStat === null
        ? false
        : samePath
          ? false
          : targetStat === null ||
            targetStat.size !== sourceStat.size ||
            sourceStat.mtimeMs > targetStat.mtimeMs

    return {
      runtimeFilePath: file.runtimeFilePath,
      invalidReason: null,
      sourcePath: file.sourcePath,
      sourceStat,
      targetPath,
      targetStat,
      stale,
      samePath,
      copyError: null,
    }
  }
}
