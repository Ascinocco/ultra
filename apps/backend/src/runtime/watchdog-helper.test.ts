import { describe, expect, it } from "vitest"

import {
  evaluateWatchdogProbe,
  getWatchdogCadenceMs,
  WATCHDOG_ACTIVE_CADENCE_MS,
  WATCHDOG_IDLE_CADENCE_MS,
  WATCHDOG_STUCK_THRESHOLD_MS,
  WATCHDOG_SUSPECT_THRESHOLD_MS,
  type WatchdogCadenceConfig,
  type WatchdogCoordinatorSnapshot,
} from "./watchdog-helper.js"

const cadence: WatchdogCadenceConfig = {
  active_ms: WATCHDOG_ACTIVE_CADENCE_MS,
  idle_ms: WATCHDOG_IDLE_CADENCE_MS,
  stuck_threshold_ms: WATCHDOG_STUCK_THRESHOLD_MS,
  suspect_threshold_ms: WATCHDOG_SUSPECT_THRESHOLD_MS,
}

function buildSnapshot(
  overrides: Partial<WatchdogCoordinatorSnapshot> = {},
): WatchdogCoordinatorSnapshot {
  return {
    active_agent_count: 1,
    active_thread_ids: ["thread_1"],
    coordinator_instance_id: "coord_instance_1",
    last_heartbeat_at: "2026-03-16T21:00:00.000Z",
    project_id: "project_1",
    status: "running",
    ...overrides,
  }
}

describe("watchdog-helper heuristics", () => {
  it("keeps active work healthy under the suspect threshold", () => {
    const result = evaluateWatchdogProbe({
      cadence,
      checkedAt: "2026-03-16T21:01:29.000Z",
      snapshot: buildSnapshot(),
    })

    expect(result.probe_state).toBe("idle")
    expect(result.component_status).toBe("healthy")
  })

  it("marks the coordinator suspect at the 90 second threshold", () => {
    const result = evaluateWatchdogProbe({
      cadence,
      checkedAt: "2026-03-16T21:01:30.000Z",
      snapshot: buildSnapshot(),
    })

    expect(result.probe_state).toBe("suspect")
    expect(result.component_status).toBe("degraded")
  })

  it("marks the coordinator stuck at the 180 second threshold", () => {
    const result = evaluateWatchdogProbe({
      cadence,
      checkedAt: "2026-03-16T21:03:00.000Z",
      snapshot: buildSnapshot(),
    })

    expect(result.probe_state).toBe("stuck")
    expect(result.component_status).toBe("down")
  })

  it("uses the slower cadence when the project has no active work", () => {
    const snapshot = buildSnapshot({
      active_agent_count: 0,
      active_thread_ids: [],
      status: "idle",
    })

    expect(getWatchdogCadenceMs(snapshot, cadence)).toBe(
      WATCHDOG_IDLE_CADENCE_MS,
    )

    const result = evaluateWatchdogProbe({
      cadence,
      checkedAt: "2026-03-16T21:10:00.000Z",
      snapshot,
    })

    expect(result.probe_state).toBe("idle")
    expect(result.component_status).toBe("healthy")
  })
})
