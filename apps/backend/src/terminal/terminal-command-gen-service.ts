import { type ChildProcess, spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

import type { TerminalCommandGenInput } from "@ultra/shared"

const SYSTEM_PROMPT = `You are a shell command generator. Given the user's request, their current working directory, and recent terminal output, produce the exact shell command they need. Respond with ONLY a JSON object: {"command": "<the command>"}
Do not explain. Do not wrap in markdown. Do not include anything else.`

const TIMEOUT_MS = 30_000
const STDERR_SNIPPET_MAX_LENGTH = 280

export type CommandGenEventListener = (
  event:
    | { type: "delta"; text: string }
    | { type: "complete"; command: string }
    | { type: "error"; message: string },
) => void

export class TerminalCommandGenService {
  private activeProcesses = new Map<string, ChildProcess>()

  private formatStderrSnippet(stderr: string): string | null {
    const normalized = stderr.replace(/\s+/g, " ").trim()
    if (!normalized) {
      return null
    }

    if (normalized.length <= STDERR_SNIPPET_MAX_LENGTH) {
      return normalized
    }

    return `${normalized.slice(0, STDERR_SNIPPET_MAX_LENGTH)}...`
  }

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
          "text",
          "--model",
          model,
          "--dangerously-skip-permissions",
          "--effort",
          "medium",
          prompt,
        ],
      }
    }

    return {
      command: "codex",
      args: ["exec", "--json", "-m", model, "-s", "danger-full-access", prompt],
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
    const prompt = this.buildPrompt(
      input.prompt,
      input.cwd,
      input.recent_output,
    )
    const { command, args } = this.buildCliArgs(
      input.provider,
      input.model,
      prompt,
    )

    // Ensure ~/.local/bin is in PATH for CLI tools (claude, codex)
    // Electron apps on macOS often don't inherit the user's shell PATH
    const localBin = join(homedir(), ".local", "bin")
    const envPath = process.env.PATH ?? ""
    const augmentedPath = envPath.includes(localBin)
      ? envPath
      : `${localBin}:${envPath}`

    const proc = spawn(command, args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: augmentedPath,
        // Clear CLAUDECODE to avoid nested session detection
        CLAUDECODE: "",
      },
    })

    // Close stdin immediately — CLI should not wait for input
    proc.stdin?.end()

    const subscriptionKey = `${input.session_id}:${crypto.randomUUID()}`
    this.activeProcesses.set(subscriptionKey, proc)

    let accumulatedOutput = ""
    let accumulatedStderr = ""
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
      const text = chunk.toString()
      accumulatedStderr += text
      accumulatedOutput += text
    })

    proc.on("close", (code, signal) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(subscriptionKey)

      if (terminated || code === null) {
        return
      }

      const parsedCommand = this.parseCommandFromOutput(accumulatedOutput)
      const stderrSnippet = this.formatStderrSnippet(accumulatedStderr)

      if (parsedCommand !== null) {
        listener({ type: "complete", command: parsedCommand })
      } else if (code !== 0) {
        const diagnostics = [`CLI exited with code ${code}`]
        if (signal) {
          diagnostics.push(`signal ${signal}`)
        }
        if (stderrSnippet !== null) {
          diagnostics.push(`stderr: ${stderrSnippet}`)
        }
        listener({
          type: "error",
          message: diagnostics.join(" | "),
        })
      } else {
        const diagnostics = ["Failed to parse command from CLI output"]
        if (stderrSnippet !== null) {
          diagnostics.push(`stderr: ${stderrSnippet}`)
        }
        listener({
          type: "error",
          message: diagnostics.join(" | "),
        })
      }
    })

    proc.on("error", (err) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(subscriptionKey)
      listener({
        type: "error",
        message: `Failed to launch ${command}: ${err.message}`,
      })
    })

    return () => {
      terminated = true
      clearTimeout(timeout)
      this.activeProcesses.delete(subscriptionKey)
      proc.kill("SIGTERM")
    }
  }
}
