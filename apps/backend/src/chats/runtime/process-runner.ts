import { spawn } from "node:child_process"
import { spawn as ptySpawn } from "node-pty"

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
    // Use PTY when streaming is requested — forces the CLI to line-buffer output
    if (options.onLine) {
      return this.runWithPty(options)
    }
    return this.runWithPipe(options)
  }

  /**
   * PTY-based execution: forces child process to use line-buffered stdout,
   * enabling real-time streaming of output lines.
   */
  private runWithPty(
    options: RuntimeProcessRunOptions,
  ): Promise<RuntimeProcessResult> {
    return new Promise((resolve, reject) => {
      let output = ""
      let lineBuffer = ""
      let timedOut = false
      let settled = false

      console.log(`[process-runner] PTY spawning: ${options.command} ${options.args.slice(0, 3).join(" ")}...`)
      const pty = ptySpawn(options.command, options.args, {
        cwd: options.cwd,
        env: (options.env ?? process.env) as Record<string, string>,
        cols: 200,
        rows: 24,
      })

      const timeout = setTimeout(() => {
        timedOut = true
        pty.kill()
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      if (options.signal) {
        const onAbort = () => {
          pty.kill()
        }

        if (options.signal.aborted) {
          onAbort()
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true })
        }
      }

      const disposeData = pty.onData((data) => {
        console.log(`[process-runner] PTY data: ${data.length} bytes at ${Date.now()}`)
        output += data

        // Line buffering — split on \n and emit complete lines
        lineBuffer += data
        const parts = lineBuffer.split("\n")
        lineBuffer = parts.pop()!
        for (const part of parts) {
          // PTY may include \r — strip it
          const cleaned = part.replace(/\r$/u, "")
          if (cleaned.length > 0) {
            options.onLine!(cleaned)
          }
        }
      })

      const disposeExit = pty.onExit(({ exitCode, signal }) => {
        clearTimeout(timeout)
        disposeData.dispose()
        disposeExit.dispose()

        if (settled) return
        settled = true

        // Flush remaining buffer
        if (lineBuffer.length > 0) {
          const cleaned = lineBuffer.replace(/\r$/u, "")
          if (cleaned.length > 0) {
            options.onLine!(cleaned)
          }
          lineBuffer = ""
        }

        // PTY merges stdout and stderr into a single stream.
        // We put everything in stdout; stderr is empty.
        resolve({
          exitCode,
          signal: null,
          stdout: output,
          stderr: "",
          stdoutLines: splitLines(output),
          stderrLines: [],
          timedOut,
        })
      })

      if (options.stdin) {
        pty.write(options.stdin)
      }
    })
  }

  /**
   * Pipe-based execution: original behavior, used when streaming is not needed.
   */
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

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString()
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
