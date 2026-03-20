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
    return new Promise((resolve, reject) => {
      let stdout = ""
      let stderr = ""
      let lineBuffer = ""
      let timedOut = false
      let settled = false
      console.log(`[process-runner] spawning: ${options.command} ${options.args.join(" ")}`)
      const child = this.spawnProcess(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: "pipe",
      })
      console.log(`[process-runner] spawned pid: ${child.pid}`)

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

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString()
        console.log(`[process-runner] stdout data event: ${text.length} bytes at ${Date.now()}`)
        stdout += text

        if (options.onLine) {
          lineBuffer += text
          const parts = lineBuffer.split("\n")
          // Last element is incomplete (no trailing \n yet) — keep in buffer
          lineBuffer = parts.pop()!
          for (const part of parts) {
            if (part.length > 0) {
              options.onLine(part)
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

        if (options.onLine && lineBuffer.length > 0) {
          options.onLine(lineBuffer)
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
