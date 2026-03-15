import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { BackendStatusSnapshot } from "../../../shared/backend-status.js"
import { createInitialBackendStatus } from "../../../shared/backend-status.js"
import { FoundationStartupErrorGate } from "../components/FoundationStartupErrorGate.js"
import { classifyFoundationStartupFailure } from "./foundation-startup.js"

function makeStatus(
  overrides: Partial<BackendStatusSnapshot>,
): BackendStatusSnapshot {
  return {
    ...createInitialBackendStatus(),
    ...overrides,
  }
}

describe("classifyFoundationStartupFailure", () => {
  it("classifies handshake failures", () => {
    const failure = classifyFoundationStartupFailure(
      makeStatus({
        phase: "degraded",
        connectionStatus: "degraded",
        message: "Handshake failed: socket refused connection",
      }),
    )

    expect(failure?.kind).toBe("handshake_failed")
  })

  it("classifies database startup failures", () => {
    const failure = classifyFoundationStartupFailure(
      makeStatus({
        phase: "failed",
        connectionStatus: "disconnected",
        message:
          "Backend failed during startup: [backend] failed to start: ULTRA_DB_PATH is required",
      }),
    )

    expect(failure?.kind).toBe("database_failed")
  })

  it("classifies generic backend startup failures", () => {
    const failure = classifyFoundationStartupFailure(
      makeStatus({
        phase: "failed",
        connectionStatus: "disconnected",
        message: "Backend failed to launch: spawn tsx ENOENT",
      }),
    )

    expect(failure?.kind).toBe("backend_unavailable")
  })
})

describe("FoundationStartupErrorGate", () => {
  it("renders the failure kind and retry action", () => {
    const failure = classifyFoundationStartupFailure(
      makeStatus({
        phase: "failed",
        connectionStatus: "disconnected",
        message: "Backend failed to launch: spawn tsx ENOENT",
      }),
    )

    if (!failure) {
      throw new Error("Expected failure classification")
    }

    const markup = renderToStaticMarkup(
      <FoundationStartupErrorGate
        failure={failure}
        onOpenSystemTools={() => undefined}
        onRetryStartup={() => undefined}
      />,
    )

    expect(markup).toContain("Retry Startup")
    expect(markup).toContain("backend_unavailable")
    expect(markup).toContain("Open System &amp; Tools")
  })
})
