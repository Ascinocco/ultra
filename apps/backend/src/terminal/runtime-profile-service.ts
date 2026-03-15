import { join, posix } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import type { ProjectId, ProjectRuntimeProfileSnapshot } from "@ultra/shared"

import { IpcProtocolError } from "../ipc/errors.js"
import type { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"

export type ResolvedRuntimeFile = {
  invalidReason: string | null
  normalizedPath: string | null
  runtimeFilePath: string
  sourcePath: string | null
}

export type ResolvedRuntimeProfile = {
  files: ResolvedRuntimeFile[]
  profile: ProjectRuntimeProfileSnapshot
  projectRootPath: string
}

function normalizeRuntimeFilePath(runtimeFilePath: string): {
  invalidReason: string | null
  normalizedPath: string | null
} {
  const trimmed = runtimeFilePath.trim()
  const candidate = trimmed.replaceAll("\\", "/")

  if (candidate.length === 0) {
    return {
      invalidReason: "Runtime file path must not be empty.",
      normalizedPath: null,
    }
  }

  if (posix.isAbsolute(candidate) || /^[A-Za-z]:\//.test(candidate)) {
    return {
      invalidReason: "Runtime file path must be project-relative.",
      normalizedPath: null,
    }
  }

  const normalizedPath = posix.normalize(candidate)

  if (
    normalizedPath === "." ||
    normalizedPath === ".." ||
    normalizedPath.startsWith("../")
  ) {
    return {
      invalidReason: "Runtime file path must stay within the project root.",
      normalizedPath: null,
    }
  }

  return {
    invalidReason: null,
    normalizedPath,
  }
}

export class RuntimeProfileService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly persistenceService: SandboxPersistenceService,
  ) {}

  resolve(projectId: ProjectId): ResolvedRuntimeProfile {
    const profile = this.persistenceService.getRuntimeProfile(projectId)
    const projectRootPath = this.getProjectRootPath(projectId)

    return {
      files: profile.runtimeFilePaths.map((runtimeFilePath) => {
        const normalized = normalizeRuntimeFilePath(runtimeFilePath)

        return {
          runtimeFilePath,
          normalizedPath: normalized.normalizedPath,
          invalidReason: normalized.invalidReason,
          sourcePath: normalized.normalizedPath
            ? join(projectRootPath, ...normalized.normalizedPath.split("/"))
            : null,
        }
      }),
      profile,
      projectRootPath,
    }
  }

  private getProjectRootPath(projectId: ProjectId): string {
    const row = this.database
      .prepare("SELECT root_path FROM projects WHERE id = ?")
      .get(projectId) as
      | {
          root_path: string | null
        }
      | undefined

    if (!row?.root_path) {
      throw new IpcProtocolError("not_found", `Project not found: ${projectId}`)
    }

    return row.root_path
  }
}
