import { spawn, type ChildProcess } from "node:child_process"

import type { TerminalCommandGenInput } from "@ultra/shared"

const SYSTEM_PROMPT = `You are a shell command generator. Given the user's request, their current working directory, and recent terminal output, produce the exact shell command they need. Respond with ONLY a JSON object: {"command": "<the command>"}
Do not explain. Do not wrap in markdown. Do not include anything else.`

const TIMEOUT_MS = 30_000

export type CommandGenEventListener = (
  event:
    | { type: "delta"; text: string }
    | { type: "complete"; command: string }
    | { type: "error"; message: string },
) => void

export class TerminalCommandGenService {
  private activeProcesses = new Map<string, ChildProcess>()

  buildPrompt(prompt: string, cwd: string, recentOutput: string): string {
    let fullPrompt = `${SYSTEM_PROMPT}\n\nCurrent working directory: ${cwd}\n`

    if (recentOutput.trim()) {
      fullPrompt += `\nRecent terminal output:\n${recentOutput}\n`
    }

    fullPrompt += `\nUser request: ${prompt}`
    return fullPrompt
  }

  buildCliArgs(
    provider: "claude" | "codex",
    model: string,
    prompt: string,
  ): { command: string; args: string[] } {
    if (provider === "claude") {
      return {
        command: "claude",
        args: [
          "-p",
          "--output-format",
          "stream-json",
          "--model",
          model,
          "--permission-mode",
          "bypassPermissions",
          "--effort",
          "medium",
          prompt,
        ],
      }
    }

    return {
      command: "codex",
      args: [
        "exec",
        "--json",
        "-m",
        model,
        "-s",
        "danger-full-access",
        prompt,
      ],
    }
  }

  parseCommandFromOutput(output: string): string | null {
    const jsonPattern = /\{[^{}]*"command"\s*:\s*"(?:[^"\\]|\\.)*"[^{}]*\}/
    const match = output.match(jsonPattern)

    if (!match) return null

    try {
      const parsed = JSON.parse(match[0]) as { command?: string }
      return typeof parsed.command === "string" ? parsed.command : null
    } catch {
      return null
    }
  }

  generate(
    input: TerminalCommandGenInput,
    listener: CommandGenEventListener,
  ): () => void {
    const prompt = this.buildPrompt(input.prompt, input.cwd, input.recent_output)
    const { command, args } = this.buildCliArgs(input.provider, input.model, prompt)

    const proc = spawn(command, args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const subscriptionKey = `${input.session_id}:${crypto.randomUUID()}`
    this.activeProcesses.set(subscriptionKey, proc)

    let accumulatedOutput = ""
    let terminated = false

    const timeout = setTimeout(() => {
      terminated = true
      proc.kill("SIGTERM")
      listener({ type: "error", message: "Command generation timed out (30s)" })
    }, TIMEOUT_MS)

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      accumulatedOutput += text
      listener({ type: "delta", text })
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      accumulatedOutput += chunk.toString()
    })

    proc.on("close", (code) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(subscriptionKey)

      if (terminated || code === null) {
        return
      }

      const parsedCommand = this.parseCommandFromOutput(accumulatedOutput)

      if (parsedCommand !== null) {
        listener({ type: "complete", command: parsedCommand })
      } else if (code !== 0) {
        listener({
          type: "error",
          message: `CLI exited with code ${code}`,
        })
      } else {
        listener({
          type: "error",
          message: "Failed to parse command from CLI output",
        })
      }
    })

    proc.on("error", (err) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(subscriptionKey)
      listener({ type: "error", message: err.message })
    })

    return () => {
      terminated = true
      clearTimeout(timeout)
      this.activeProcesses.delete(subscriptionKey)
      proc.kill("SIGTERM")
    }
  }
}
