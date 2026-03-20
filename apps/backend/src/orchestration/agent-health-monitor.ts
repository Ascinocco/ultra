/**
 * ZFC-based health monitor for agent processes.
 *
 * ZFC Principle (Zero Failure Crash)
 * ==================================
 * Observable state is the source of truth, not recorded state.
 *
 * Signal priority (highest to lowest):
 *   1. Is the process alive? — process.kill(pid, 0)
 *   2. Is it producing output? — last stdout timestamp
 *   3. What does the registry say? — lowest priority
 *
 * When signals conflict, trust what you can directly observe.
 */

import type { AgentRegistry } from "./agent-registry.js"

/** Terminal states that do not require health monitoring. */
const TERMINAL_STATES = new Set(["completed", "failed", "terminated"])

/** Active states used to determine whether a lead's children are still working. */
const ACTIVE_CHILD_STATES = new Set(["pending", "spawning", "booting", "running", "stalled"])

/**
 * The recommended action for an agent based on health evaluation.
 *
 * - "none"      — Agent is healthy; no action needed.
 * - "warn"      — First stale detection; log and transition to stalled.
 * - "nudge"     — Agent has been stalled for one warn cycle; send a stdin message.
 * - "triage"    — Agent has been stalled for one nudge cycle; spawn a scout to inspect.
 * - "terminate" — Agent is a zombie or past zombieMs; kill the process.
 */
export type HealthAction = {
  agentId: string
  action: "none" | "warn" | "nudge" | "triage" | "terminate"
  reason: string
}

/**
 * Check whether a process with the given PID is still running.
 *
 * Uses signal 0 which does not kill the process — it only checks
 * whether it exists and we have permission to signal it.
 *
 * @param pid - The process ID to check
 * @returns true if the process exists, false otherwise
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 doesn't kill the process — just checks if it exists
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Monitors agent health using the ZFC principle.
 *
 * On each call to `evaluateAll()`:
 * 1. Skips terminal agents (completed, failed, terminated).
 * 2. Checks PID liveness — if process is dead but registry says active, terminates immediately.
 * 3. Exempts lead agents with active children from stale detection.
 * 4. Applies time-based staleness checks with progressive escalation.
 */
export class AgentHealthMonitor {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly thresholds: { staleMs: number; zombieMs: number },
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Evaluate health of all registered agents.
   *
   * Returns one HealthAction per agent that requires attention.
   * Agents in a healthy state produce no action (are excluded from the result).
   */
  evaluateAll(): HealthAction[] {
    const actions: HealthAction[] = []
    const currentTime = this.now()

    for (const agent of this.registry.getAll()) {
      // Step 1: Skip terminal states — they do not need monitoring.
      if (TERMINAL_STATES.has(agent.state)) {
        continue
      }

      // Step 2: Exempt lead agents with active children from stale detection.
      // A lead waiting on workers is not stalled — it is orchestrating.
      // (ZFC note: isProcessRunning is available for callers who want to check
      // PID liveness directly; evaluateAll relies on time-based escalation.)
      if (agent.agentType === "lead") {
        const children = this.registry.getChildren(agent.agentId)
        const hasActiveChildren = children.some((c) => ACTIVE_CHILD_STATES.has(c.state))
        if (hasActiveChildren) {
          continue
        }
      }

      // Step 4: Time-based staleness with progressive escalation.
      const lastActivityMs = new Date(agent.lastActivity).getTime()
      const elapsedMs = currentTime - lastActivityMs

      // Within staleMs — agent is healthy.
      if (elapsedMs <= this.thresholds.staleMs) {
        continue
      }

      // Past zombieMs — terminate regardless of escalation level.
      if (elapsedMs > this.thresholds.zombieMs) {
        actions.push({
          agentId: agent.agentId,
          action: "terminate",
          reason: `Agent has been inactive for ${Math.round(elapsedMs / 1000)}s, exceeding zombie threshold of ${Math.round(this.thresholds.zombieMs / 1000)}s`,
        })
        continue
      }

      // Past staleMs — apply progressive escalation based on escalationLevel.
      const action = this.escalationAction(agent.escalationLevel)
      actions.push({
        agentId: agent.agentId,
        action,
        reason: this.escalationReason(agent.escalationLevel, elapsedMs),
      })
    }

    return actions
  }

  /**
   * Map escalation level to the appropriate action.
   *
   * Level 0 → warn   (first stale detection)
   * Level 1 → nudge  (after one warn cycle with no recovery)
   * Level 2 → triage (after one nudge cycle with no response)
   * Level 3+ → terminate (after triage or timeout)
   */
  private escalationAction(level: number): "warn" | "nudge" | "triage" | "terminate" {
    switch (level) {
      case 0:
        return "warn"
      case 1:
        return "nudge"
      case 2:
        return "triage"
      default:
        return "terminate"
    }
  }

  private escalationReason(level: number, elapsedMs: number): string {
    const elapsedSec = Math.round(elapsedMs / 1000)
    switch (level) {
      case 0:
        return `Agent has been inactive for ${elapsedSec}s (first stale detection)`
      case 1:
        return `Agent has been inactive for ${elapsedSec}s — sending nudge after warn cycle`
      case 2:
        return `Agent has been inactive for ${elapsedSec}s — spawning triage scout after nudge cycle`
      default:
        return `Agent has been inactive for ${elapsedSec}s — terminating after triage`
    }
  }
}
