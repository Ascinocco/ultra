import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

export type WatchdogProbeState = "idle" | "suspect" | "stuck"

export type WatchdogCoordinatorSnapshot = {
  active_agent_count: number
  active_thread_ids: string[]
  coordinator_instance_id: string | null
  last_heartbeat_at: string | null
  project_id: string
  status: string
}

export type WatchdogCadenceConfig = {
  active_ms: number
  idle_ms: number
  stuck_threshold_ms: number
  suspect_threshold_ms: number
}

export type WatchdogHelloMessage = {
  kind: "hello"
  payload: {
    cadence: WatchdogCadenceConfig
    coordinator_snapshot: WatchdogCoordinatorSnapshot
    project_id: string
    protocol_version: "1.0"
  }
}

export type WatchdogCoordinatorSnapshotMessage = {
  kind: "coordinator_snapshot"
  payload: WatchdogCoordinatorSnapshot
}

export type WatchdogShutdownMessage = {
  kind: "shutdown"
}

export type WatchdogBackendMessage =
  | WatchdogHelloMessage
  | WatchdogCoordinatorSnapshotMessage
  | WatchdogShutdownMessage

export type WatchdogProbeResult = {
  active_thread_ids: string[]
  checked_at: string
  component_status: "healthy" | "degraded" | "down"
  last_heartbeat_at: string | null
  probe_state: WatchdogProbeState
  project_id: string
  reason: string | null
}

export type WatchdogProbeResultMessage = {
  kind: "probe_result"
  payload: WatchdogProbeResult
}

export const WATCHDOG_ACTIVE_CADENCE_MS = 60_000
export const WATCHDOG_IDLE_CADENCE_MS = 300_000
export const WATCHDOG_SUSPECT_THRESHOLD_MS = 90_000
export const WATCHDOG_STUCK_THRESHOLD_MS = 180_000

function parseTimestamp(timestamp: string | null): number | null {
  if (!timestamp) {
    return null
  }

  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? null : parsed
}

export function getWatchdogCadenceMs(
  snapshot: WatchdogCoordinatorSnapshot,
  cadence: WatchdogCadenceConfig,
): number {
  return snapshot.active_thread_ids.length > 0
    ? cadence.active_ms
    : cadence.idle_ms
}

export function evaluateWatchdogProbe(input: {
  checkedAt: string
  snapshot: WatchdogCoordinatorSnapshot
  cadence: WatchdogCadenceConfig
}): WatchdogProbeResult {
  const { checkedAt, snapshot } = input

  if (snapshot.active_thread_ids.length === 0) {
    return {
      active_thread_ids: [],
      checked_at: checkedAt,
      component_status: "healthy",
      last_heartbeat_at: snapshot.last_heartbeat_at,
      probe_state: "idle",
      project_id: snapshot.project_id,
      reason: null,
    }
  }

  const checkedAtMs = parseTimestamp(checkedAt)
  const lastHeartbeatMs = parseTimestamp(snapshot.last_heartbeat_at)
  const heartbeatAgeMs =
    checkedAtMs === null || lastHeartbeatMs === null
      ? Number.POSITIVE_INFINITY
      : Math.max(checkedAtMs - lastHeartbeatMs, 0)

  if (heartbeatAgeMs >= input.cadence.stuck_threshold_ms) {
    return {
      active_thread_ids: [...snapshot.active_thread_ids],
      checked_at: checkedAt,
      component_status: "down",
      last_heartbeat_at: snapshot.last_heartbeat_at,
      probe_state: "stuck",
      project_id: snapshot.project_id,
      reason:
        lastHeartbeatMs === null
          ? "Coordinator heartbeat is missing."
          : "Coordinator heartbeat exceeded the stuck threshold.",
    }
  }

  if (heartbeatAgeMs >= input.cadence.suspect_threshold_ms) {
    return {
      active_thread_ids: [...snapshot.active_thread_ids],
      checked_at: checkedAt,
      component_status: "degraded",
      last_heartbeat_at: snapshot.last_heartbeat_at,
      probe_state: "suspect",
      project_id: snapshot.project_id,
      reason: "Coordinator heartbeat exceeded the suspect threshold.",
    }
  }

  return {
    active_thread_ids: [...snapshot.active_thread_ids],
    checked_at: checkedAt,
    component_status: "healthy",
    last_heartbeat_at: snapshot.last_heartbeat_at,
    probe_state: "idle",
    project_id: snapshot.project_id,
    reason: null,
  }
}

class WatchdogHelperRuntime {
  private cadence: WatchdogCadenceConfig = {
    active_ms: WATCHDOG_ACTIVE_CADENCE_MS,
    idle_ms: WATCHDOG_IDLE_CADENCE_MS,
    stuck_threshold_ms: WATCHDOG_STUCK_THRESHOLD_MS,
    suspect_threshold_ms: WATCHDOG_SUSPECT_THRESHOLD_MS,
  }
  private snapshot: WatchdogCoordinatorSnapshot | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  handleMessage(message: WatchdogBackendMessage): void {
    switch (message.kind) {
      case "hello":
        this.cadence = message.payload.cadence
        this.snapshot = message.payload.coordinator_snapshot
        this.emitProbe()
        this.scheduleNextProbe()
        return
      case "coordinator_snapshot":
        this.snapshot = message.payload
        this.emitProbe()
        this.scheduleNextProbe()
        return
      case "shutdown":
        this.dispose()
        process.exit(0)
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private emitProbe(): void {
    if (!this.snapshot) {
      return
    }

    const payload = evaluateWatchdogProbe({
      cadence: this.cadence,
      checkedAt: this.now(),
      snapshot: this.snapshot,
    })

    process.stdout.write(
      `${JSON.stringify({ kind: "probe_result", payload })}\n`,
    )
  }

  private scheduleNextProbe(): void {
    this.dispose()

    if (!this.snapshot) {
      return
    }

    this.timer = setTimeout(
      () => {
        this.emitProbe()
        this.scheduleNextProbe()
      },
      getWatchdogCadenceMs(this.snapshot, this.cadence),
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isCoordinatorSnapshot(
  value: unknown,
): value is WatchdogCoordinatorSnapshot {
  return (
    isRecord(value) &&
    typeof value.project_id === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.active_thread_ids) &&
    value.active_thread_ids.every((entry) => typeof entry === "string") &&
    typeof value.active_agent_count === "number" &&
    (typeof value.coordinator_instance_id === "string" ||
      value.coordinator_instance_id === null) &&
    (typeof value.last_heartbeat_at === "string" ||
      value.last_heartbeat_at === null)
  )
}

function isCadenceConfig(value: unknown): value is WatchdogCadenceConfig {
  return (
    isRecord(value) &&
    typeof value.active_ms === "number" &&
    typeof value.idle_ms === "number" &&
    typeof value.suspect_threshold_ms === "number" &&
    typeof value.stuck_threshold_ms === "number"
  )
}

function parseBackendMessage(input: string): WatchdogBackendMessage | null {
  const parsed = JSON.parse(input) as unknown

  if (!isRecord(parsed) || typeof parsed.kind !== "string") {
    return null
  }

  if (parsed.kind === "shutdown") {
    return { kind: "shutdown" }
  }

  if (!isRecord(parsed.payload)) {
    return null
  }

  if (
    parsed.kind === "hello" &&
    typeof parsed.payload.project_id === "string" &&
    parsed.payload.protocol_version === "1.0" &&
    isCadenceConfig(parsed.payload.cadence) &&
    isCoordinatorSnapshot(parsed.payload.coordinator_snapshot)
  ) {
    return {
      kind: "hello",
      payload: {
        cadence: parsed.payload.cadence,
        coordinator_snapshot: parsed.payload.coordinator_snapshot,
        project_id: parsed.payload.project_id,
        protocol_version: "1.0",
      },
    }
  }

  if (
    parsed.kind === "coordinator_snapshot" &&
    isCoordinatorSnapshot(parsed.payload)
  ) {
    return {
      kind: "coordinator_snapshot",
      payload: parsed.payload,
    }
  }

  return null
}

export function runWatchdogHelper(): void {
  const runtime = new WatchdogHelperRuntime()
  const readline = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: process.stdin,
  })

  readline.on("line", (line) => {
    if (!line.trim()) {
      return
    }

    try {
      const message = parseBackendMessage(line)
      if (!message) {
        return
      }

      runtime.handleMessage(message)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      process.stderr.write(`watchdog-helper parse failure: ${reason}\n`)
    }
  })

  process.once("SIGINT", () => {
    runtime.dispose()
    process.exit(0)
  })
  process.once("SIGTERM", () => {
    runtime.dispose()
    process.exit(0)
  })
}

const entryPath = process.argv[1]
const currentPath = fileURLToPath(import.meta.url)

if (entryPath && currentPath === entryPath) {
  runWatchdogHelper()
}
