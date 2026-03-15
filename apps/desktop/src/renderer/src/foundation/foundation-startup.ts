import type { BackendStatusSnapshot } from "../../../shared/backend-status.js"

export type FoundationStartupFailureKind =
  | "backend_unavailable"
  | "handshake_failed"
  | "database_failed"

export type FoundationStartupFailure = {
  kind: FoundationStartupFailureKind
  title: string
  summary: string
  recovery: string
}

function looksLikeDatabaseFailure(message: string): boolean {
  const lowered = message.toLowerCase()
  return (
    lowered.includes("database") ||
    lowered.includes("sqlite") ||
    lowered.includes("migration") ||
    lowered.includes("ultra_db_path")
  )
}

export function classifyFoundationStartupFailure(
  status: BackendStatusSnapshot,
): FoundationStartupFailure | null {
  const message = status.message.trim()

  if (status.connectionStatus === "connected") {
    return null
  }

  if (message.startsWith("Handshake failed:")) {
    return {
      kind: "handshake_failed",
      title: "Ultra could not complete the backend handshake",
      summary: message,
      recovery:
        "Retry startup. If the failure persists, check the backend logs and local socket setup.",
    }
  }

  if (looksLikeDatabaseFailure(message)) {
    return {
      kind: "database_failed",
      title: "Ultra could not initialize its local database",
      summary: message,
      recovery:
        "Retry startup after checking the database path, migration files, and local disk permissions.",
    }
  }

  if (status.phase === "failed" || status.phase === "degraded") {
    return {
      kind: "backend_unavailable",
      title: "Ultra could not start its local backend",
      summary: message,
      recovery:
        "Retry startup. If the backend keeps failing, inspect the desktop console and backend stdout/stderr output.",
    }
  }

  return null
}
