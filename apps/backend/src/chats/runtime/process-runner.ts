import { spawn } from "node:child_process"

import type {
  RuntimeProcessResult,
  RuntimeProcessRunner,
  RuntimeProcessRunOptions,
  SpawnProcess,
} from "./types.js"

const DEFAULT_TIMEOUT_MS = 120_000

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

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      child.once("error", (error) => {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          reject(error)
        }
      })
      child.once("close", (code, signal) => {
        clearTimeout(timeout)
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
