import { describe, expect, it } from "vitest"
import { SpawnRuntimeProcessRunner } from "./process-runner.js"

describe("SpawnRuntimeProcessRunner", () => {
  it("calls onLine for each stdout line during execution", async () => {
    const lines: string[] = []
    const runner = new SpawnRuntimeProcessRunner()

    const result = await runner.run({
      command: "printf",
      args: ["line1\\nline2\\nline3\\n"],
      cwd: "/tmp",
      onLine: (line) => lines.push(line),
    })

    expect(lines).toEqual(["line1", "line2", "line3"])
    expect(result.exitCode).toBe(0)
    expect(result.stdoutLines).toContain("line1")
  })

  it("still works without onLine callback", async () => {
    const runner = new SpawnRuntimeProcessRunner()

    const result = await runner.run({
      command: "echo",
      args: ["hello"],
      cwd: "/tmp",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdoutLines).toContain("hello")
  })

  it("handles partial lines across chunks", async () => {
    const lines: string[] = []
    const runner = new SpawnRuntimeProcessRunner()

    const result = await runner.run({
      command: "printf",
      args: ["partial"],
      cwd: "/tmp",
      onLine: (line) => lines.push(line),
    })

    expect(lines).toEqual(["partial"])
    expect(result.exitCode).toBe(0)
  })


  it("kills the child process when the abort signal fires", async () => {
    const controller = new AbortController()
    const runner = new SpawnRuntimeProcessRunner()
    const resultPromise = runner.run({
      command: "sleep",
      args: ["60"],
      cwd: "/tmp",
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()
    const result = await resultPromise
    expect(result.signal).toBe("SIGTERM")
    expect(result.exitCode).toBeNull()
    expect(result.timedOut).toBe(false)
  })

  it("resolves normally when no signal is provided", async () => {
    const runner = new SpawnRuntimeProcessRunner()
    const result = await runner.run({
      command: "echo",
      args: ["hello"],
      cwd: "/tmp",
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("hello")
    expect(result.signal).toBeNull()
  })

  it("escalates to SIGKILL if process ignores SIGTERM", async () => {
    const controller = new AbortController()
    const runner = new SpawnRuntimeProcessRunner()
    const resultPromise = runner.run({
      command: "bash",
      args: ["-c", 'trap "" TERM; sleep 60'],
      cwd: "/tmp",
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()
    const result = await resultPromise
    expect(result.signal).toBe("SIGKILL")
    expect(result.exitCode).toBeNull()
  }, 10_000)
})
