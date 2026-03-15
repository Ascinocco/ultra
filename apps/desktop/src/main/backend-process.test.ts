import { EventEmitter } from "node:events"

import { describe, expect, it, vi } from "vitest"

import type { BackendLaunchConfig } from "./backend-config.js"
import { BackendProcessManager } from "./backend-process.js"

class FakeStream extends EventEmitter {
  emitData(value: string) {
    this.emit("data", Buffer.from(value))
  }
}

class FakeChildProcess extends EventEmitter {
  pid: number
  stdout = new FakeStream()
  stderr = new FakeStream()
  killSignals: Array<NodeJS.Signals | undefined> = []

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(signal?: NodeJS.Signals) {
    this.killSignals.push(signal)

    if (signal === "SIGTERM" || signal === "SIGKILL" || signal === undefined) {
      this.emit("exit", 0, null)
    }

    return true
  }
}

function createConfig(
  overrides?: Partial<BackendLaunchConfig>,
): BackendLaunchConfig {
  return {
    command: "tsx",
    args: ["src/index.ts"],
    cwd: "/Users/tony/Projects/ultra/apps/backend",
    env: {},
    socketPath: "/tmp/ultra-backend.sock",
    databasePath: "/tmp/ultra.db",
    startupGraceMs: 25,
    shutdownTimeoutMs: 25,
    restartDelayMs: 25,
    maxRestartAttempts: 2,
    isDev: true,
    ...overrides,
  }
}

describe("BackendProcessManager", () => {
  it("transitions to running when the backend prints a ready marker", () => {
    const child = new FakeChildProcess(101)
    const manager = new BackendProcessManager({
      config: createConfig(),
      spawnProcess: () => child,
      now: () => "2026-03-14T00:00:00Z",
      logger: { info: () => undefined, error: () => undefined },
    })

    manager.start()
    child.stdout.emitData("Ultra backend scaffold ready for Ultra workspace")

    expect(manager.getStatus().phase).toBe("running")
    expect(manager.getStatus().connectionStatus).toBe("connecting")
    expect(manager.getStatus().pid).toBe(101)
  })

  it("restarts after an unexpected exit and reports degraded state first", async () => {
    vi.useFakeTimers()

    const firstChild = new FakeChildProcess(101)
    const secondChild = new FakeChildProcess(202)
    const spawnProcess = vi
      .fn<
        Parameters<
          NonNullable<
            ConstructorParameters<
              typeof BackendProcessManager
            >[0]["spawnProcess"]
          >
        >,
        ReturnType<
          NonNullable<
            ConstructorParameters<
              typeof BackendProcessManager
            >[0]["spawnProcess"]
          >
        >
      >()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild)

    const manager = new BackendProcessManager({
      config: createConfig(),
      spawnProcess,
      now: () => "2026-03-14T00:00:00Z",
      logger: { info: () => undefined, error: () => undefined },
    })

    manager.start()
    firstChild.emit("exit", 1, null)

    expect(manager.getStatus().phase).toBe("degraded")
    expect(manager.getStatus().restartCount).toBe(1)

    await vi.advanceTimersByTimeAsync(30)
    secondChild.stdout.emitData(
      "Ultra backend scaffold ready for Ultra workspace",
    )

    expect(manager.getStatus().phase).toBe("running")
    expect(manager.getStatus().pid).toBe(202)

    vi.useRealTimers()
  })

  it("stops the backend child on shutdown", async () => {
    const child = new FakeChildProcess(303)
    const manager = new BackendProcessManager({
      config: createConfig(),
      spawnProcess: () => child,
      now: () => "2026-03-14T00:00:00Z",
      logger: { info: () => undefined, error: () => undefined },
    })

    manager.start()
    child.stdout.emitData("Ultra backend scaffold ready for Ultra workspace")

    await manager.stop()

    expect(child.killSignals).toContain("SIGTERM")
    expect(manager.getStatus().phase).toBe("stopped")
  })

  it("surfaces launch failures as failed backend-unavailable state", () => {
    const manager = new BackendProcessManager({
      config: createConfig(),
      spawnProcess: () => {
        throw new Error("spawn tsx ENOENT")
      },
      now: () => "2026-03-14T00:00:00Z",
      logger: { info: () => undefined, error: () => undefined },
    })

    manager.start()

    expect(manager.getStatus().phase).toBe("failed")
    expect(manager.getStatus().message).toContain("Backend failed to launch")
  })

  it("preserves startup stderr detail when retries are exhausted", async () => {
    vi.useFakeTimers()

    const firstChild = new FakeChildProcess(101)
    const secondChild = new FakeChildProcess(202)
    const thirdChild = new FakeChildProcess(303)
    const spawnProcess = vi
      .fn<
        Parameters<
          NonNullable<
            ConstructorParameters<
              typeof BackendProcessManager
            >[0]["spawnProcess"]
          >
        >,
        ReturnType<
          NonNullable<
            ConstructorParameters<
              typeof BackendProcessManager
            >[0]["spawnProcess"]
          >
        >
      >()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild)
      .mockReturnValueOnce(thirdChild)

    const manager = new BackendProcessManager({
      config: createConfig(),
      spawnProcess,
      now: () => "2026-03-14T00:00:00Z",
      logger: { info: () => undefined, error: () => undefined },
    })

    manager.start()
    firstChild.stderr.emitData(
      "[backend] failed to start: ULTRA_DB_PATH is required",
    )
    firstChild.emit("exit", 1, null)
    await vi.advanceTimersByTimeAsync(30)

    secondChild.stderr.emitData(
      "[backend] failed to start: ULTRA_DB_PATH is required",
    )
    secondChild.emit("exit", 1, null)
    await vi.advanceTimersByTimeAsync(30)

    thirdChild.stderr.emitData(
      "[backend] failed to start: ULTRA_DB_PATH is required",
    )
    thirdChild.emit("exit", 1, null)

    expect(manager.getStatus().phase).toBe("failed")
    expect(manager.getStatus().message).toContain("ULTRA_DB_PATH is required")

    vi.useRealTimers()
  })
})
