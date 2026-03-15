import type { ConnectionStatus } from "@ultra/shared"

export type BackendLifecyclePhase =
  | "idle"
  | "starting"
  | "running"
  | "degraded"
  | "failed"
  | "stopped"

export type BackendStatusSnapshot = {
  phase: BackendLifecyclePhase
  connectionStatus: ConnectionStatus
  message: string
  socketPath: string | null
  pid: number | null
  restartCount: number
  lastExitCode: number | null
  lastSignal: string | null
  updatedAt: string
}

export type BackendStatusListener = (status: BackendStatusSnapshot) => void

export function createInitialBackendStatus(): BackendStatusSnapshot {
  return {
    phase: "starting",
    connectionStatus: "connecting",
    message: "Starting local backend…",
    socketPath: null,
    pid: null,
    restartCount: 0,
    lastExitCode: null,
    lastSignal: null,
    updatedAt: new Date(0).toISOString(),
  }
}
