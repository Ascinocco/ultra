import type { DependencyTool, EnvironmentSessionMode } from "@ultra/shared"
import { describe, expect, it } from "vitest"

import { EnvironmentReadinessService } from "./environment-readiness-service.js"

type ProbeMap = Partial<Record<DependencyTool, string | Error>>

const toolCommandToId: Record<string, DependencyTool> = {
  git: "git",
  codex: "codex",
  claude: "claude",
  node: "node",
  pnpm: "pnpm",
}

async function buildSnapshot(
  sessionMode: EnvironmentSessionMode,
  probes: ProbeMap = {},
) {
  const service = new EnvironmentReadinessService(
    sessionMode,
    async (command) => {
      const tool = toolCommandToId[command]
      const outcome = probes[tool]

      if (outcome instanceof Error) {
        throw outcome
      }

      return {
        stdout: typeof outcome === "string" ? outcome : `v99.0.0`,
        stderr: "",
      }
    },
    () => "2026-03-15T00:00:00.000Z",
    {
      nodeMinVersion: "22.18.0",
      pnpmMinVersion: "10.21.0",
    },
  )

  return service.getEnvironmentReadiness()
}

function missingCommandError(command: string): NodeJS.ErrnoException {
  const error = new Error(`${command} missing`) as NodeJS.ErrnoException
  error.code = "ENOENT"
  return error
}

describe("EnvironmentReadinessService", () => {
  it("returns ready when all runtime and development tools are available", async () => {
    const snapshot = await buildSnapshot("development")

    expect(snapshot.status).toBe("ready")
    expect(
      snapshot.checks.every(
        (check) => check.status === "ready" || check.status === "skipped",
      ),
    ).toBe(true)
  })

  it("blocks when claude is missing while keeping codex optional", async () => {
    const snapshotBoth = await buildSnapshot("desktop", {
      codex: missingCommandError("codex"),
      claude: missingCommandError("claude"),
    })

    expect(snapshotBoth.status).toBe("blocked")
    expect(
      snapshotBoth.checks.find((check) => check.tool === "codex")?.status,
    ).toBe("missing")
    expect(
      snapshotBoth.checks.find((check) => check.tool === "claude")?.status,
    ).toBe("missing")

    const snapshotCodexOnly = await buildSnapshot("desktop", {
      codex: missingCommandError("codex"),
    })

    expect(snapshotCodexOnly.status).toBe("ready")
    expect(
      snapshotCodexOnly.checks.find((check) => check.tool === "codex")?.status,
    ).toBe("missing")
  })

  it("reports codex probe errors without blocking desktop startup", async () => {
    const snapshot = await buildSnapshot("desktop", {
      codex: new Error("codex probe failed"),
    })

    expect(snapshot.status).toBe("ready")
    expect(snapshot.checks.find((check) => check.tool === "codex")?.status).toBe(
      "error",
    )
  })

  it("blocks development sessions on unsupported node or pnpm versions", async () => {
    const snapshot = await buildSnapshot("development", {
      node: "v20.0.0",
      pnpm: "9.0.0",
    })

    expect(snapshot.status).toBe("blocked")
    expect(snapshot.checks.find((check) => check.tool === "node")?.status).toBe(
      "unsupported",
    )
    expect(snapshot.checks.find((check) => check.tool === "pnpm")?.status).toBe(
      "unsupported",
    )
  })

  it("skips node and pnpm in desktop runtime sessions", async () => {
    const snapshot = await buildSnapshot("desktop", {
      node: "v1.0.0",
      pnpm: "1.0.0",
    })

    expect(snapshot.status).toBe("ready")
    expect(snapshot.checks.find((check) => check.tool === "node")?.status).toBe(
      "skipped",
    )
    expect(snapshot.checks.find((check) => check.tool === "pnpm")?.status).toBe(
      "skipped",
    )
  })
})
