import { spawn } from "node:child_process"

import type {
  RuntimeProcessResult,
  RuntimeProcessRunner,
  RuntimeProcessRunOptions,
  SpawnProcess,
} from "./types.js"

const DEFAULT_TIMEOUT_MS = 120_000
const SIGKILL_GRACE_MS = 3_000

function splitLines(input: string): string[] {
  return input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export class SpawnRuntimeProcessRunner implements RuntimeProcessRunner {
  constructor(
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
  ) {}

  async run(options: RuntimeProcessRunOptions): Promise<RuntimeProcessResult> {
    return this.runWithPipe(options)
  }

  private runWithPipe(
    options: RuntimeProcessRunOptions,
  ): Promise<RuntimeProcessResult> {
    return new Promise((resolve, reject) => {
      let stdout = ""
      let stderr = ""
      let timedOut = false
      let settled = false
      const child = this.spawnProcess(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: "pipe",
      })

      const timeout = setTimeout(() => {
        timedOut = true
        child.kill("SIGKILL")
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      let killEscalationTimeout: ReturnType<typeof setTimeout> | null = null

      if (options.signal) {
        const onAbort = () => {
          child.kill("SIGTERM")
          killEscalationTimeout = setTimeout(() => {
            child.kill("SIGKILL")
          }, SIGKILL_GRACE_MS)
        }

        if (options.signal.aborted) {
          onAbort()
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true })
        }
      }

      let lineBuffer = ""

      child.stdout.on("data", (chunk) => {
        const data = chunk.toString() as string
        stdout += data

        if (options.onLine) {
          lineBuffer += data
          const parts = lineBuffer.split("\n")
          lineBuffer = parts.pop()!
          for (const part of parts) {
            const trimmed = part.trimEnd()
            if (trimmed.length > 0) {
              options.onLine(trimmed)
            }
          }
        }
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      child.once("error", (error) => {
        clearTimeout(timeout)
        if (killEscalationTimeout) clearTimeout(killEscalationTimeout)
        if (!settled) {
          settled = true
          reject(error)
        }
      })
      child.once("close", (code, signal) => {
        clearTimeout(timeout)
        if (killEscalationTimeout) clearTimeout(killEscalationTimeout)
        if (settled) {
          return
        }

        settled = true

        // Flush any remaining line buffer content
        if (options.onLine && lineBuffer.length > 0) {
          const trimmed = lineBuffer.trimEnd()
          if (trimmed.length > 0) {
            options.onLine(trimmed)
          }
          lineBuffer = ""
        }

        resolve({
          exitCode: code,
          signal,
          stdout,
          stderr,
          stdoutLines: splitLines(stdout),
          stderrLines: splitLines(stderr),
          timedOut,
        })
      })

      if (options.stdin) {
        child.stdin.write(options.stdin)
      }

      child.stdin.end()
    })
  }
}
