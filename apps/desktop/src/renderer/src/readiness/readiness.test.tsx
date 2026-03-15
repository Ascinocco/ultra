import type { EnvironmentReadinessSnapshot } from "@ultra/shared"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { EnvironmentReadinessGate } from "../components/EnvironmentReadinessGate.js"
import { SystemToolsPanel } from "../components/SystemToolsPanel.js"
import { createAppStore } from "../state/app-store.js"

function makeSnapshot(
  status: "ready" | "blocked" = "blocked",
): EnvironmentReadinessSnapshot {
  return {
    status,
    sessionMode: "desktop",
    checkedAt: "2026-03-15T00:00:00.000Z",
    checks: [
      {
        tool: "ov",
        displayName: "Overstory CLI",
        scope: "runtime-required",
        requiredInCurrentSession: true,
        status: status === "blocked" ? "missing" : "ready",
        detectedVersion: status === "blocked" ? null : "1.0.0",
        command: "ov --version",
        helpText: "Install Overstory and ensure `ov` is on PATH.",
      },
    ],
  }
}

describe("environment readiness UI", () => {
  it("renders the blocking readiness screen for blocked snapshots", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentReadinessGate
        snapshot={makeSnapshot("blocked")}
        status="blocked"
        error={null}
        onOpenSystemTools={() => undefined}
        onRecheck={() => undefined}
      />,
    )

    expect(markup).toContain("Startup readiness")
    expect(markup).toContain("Overstory CLI")
    expect(markup).toContain("missing")
  })

  it("renders the System & Tools panel when open", () => {
    const markup = renderToStaticMarkup(
      <SystemToolsPanel
        open={true}
        snapshot={makeSnapshot("ready")}
        status="ready"
        error={null}
        onClose={() => undefined}
        onRecheck={() => undefined}
      />,
    )

    expect(markup).toContain("System &amp; Tools")
    expect(markup).toContain("Session mode: desktop. Environment is ready.")
  })
})

describe("readiness store actions", () => {
  it("stores blocked readiness snapshots", () => {
    const store = createAppStore()

    store.getState().actions.setReadinessSnapshot(makeSnapshot("blocked"))

    expect(store.getState().readiness.status).toBe("blocked")
    expect(store.getState().readiness.snapshot?.status).toBe("blocked")
  })

  it("opens and closes the System & Tools surface", () => {
    const store = createAppStore()

    store.getState().actions.setSystemToolsOpen(true)
    expect(store.getState().readiness.systemToolsOpen).toBe(true)

    store.getState().actions.setSystemToolsOpen(false)
    expect(store.getState().readiness.systemToolsOpen).toBe(false)
  })
})
