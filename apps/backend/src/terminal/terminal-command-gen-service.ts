import { type ChildProcess, spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

import type { TerminalCommandGenInput } from "@ultra/shared"

const SYSTEM_PROMPT = `You are a shell command generator. Given the user's request, their current working directory, and recent terminal output, produce the exact shell command they need. Respond with ONLY a JSON object: {"command": "<the command>"}
Do not explain. Do not wrap in markdown. Do not include anything else.`

const TIMEOUT_MS = 30_000
const STDERR_SNIPPET_MAX_LENGTH = 280
const COMMAND_JSON_PATTERN =
  /\{[^{}]*"command"\s*:\s*"(?:[^"\\]|\\.)*"[^{}]*\}/g

type JsonRecord = Record<string, unknown>

export type CommandGenEventListener = (
  event:
    | { type: "delta"; text: string }
    | { type: "complete"; command: string }
    | { type: "error"; message: string },
) => void

export class TerminalCommandGenService {
  private activeProcesses = new Map<string, ChildProcess>()

  private isJsonRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null
  }

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
      args: [
        "-a",
        "never",
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

  private parseCommandObject(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw) as JsonRecord
      const command = parsed.command
      if (typeof command !== "string" || command.trim().length === 0) {
        return null
      }

      const payloadType = parsed.type
      if (
        typeof payloadType === "string" &&
        !payloadType.includes("assistant") &&
        !payloadType.includes("complete")
      ) {
        return null
      }

      return command
    } catch {
      return null
    }
  }

  private extractTextCandidate(input: unknown): string | null {
    if (!this.isJsonRecord(input)) {
      return null
    }

    const candidateKeys = ["text", "delta", "content", "message"]
    for (const key of candidateKeys) {
      const value = input[key]
      if (typeof value === "string" && value.trim().length > 0) {
        return value
      }
    }

    if (this.isJsonRecord(input.delta) && typeof input.delta.text === "string") {
      return input.delta.text
    }

    if (Array.isArray(input.content)) {
      const parts = input.content
        .map((part) =>
          this.isJsonRecord(part) && typeof part.text === "string"
            ? part.text
            : "",
        )
        .filter((text) => text.length > 0)
      if (parts.length > 0) {
        return parts.join("")
      }
    }

    for (const value of Object.values(input)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = this.extractTextCandidate(item)
          if (found) {
            return found
          }
        }
        continue
      }

      const found = this.extractTextCandidate(value)
      if (found) {
        return found
      }
    }

    return null
  }

  private parseCommandFromCommandJsonChunks(output: string): string | null {
    for (const match of output.matchAll(COMMAND_JSON_PATTERN)) {
      const parsed = this.parseCommandObject(match[0])
      if (parsed !== null) {
        return parsed
      }
    }

    return null
  }

  private parseCommandFromJsonLines(output: string): string | null {
    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line.length === 0) {
        continue
      }

      const direct = this.parseCommandObject(line)
      if (direct !== null) {
        return direct
      }

      let parsedLine: unknown
      try {
        parsedLine = JSON.parse(line)
      } catch {
        continue
      }

      const textCandidate = this.extractTextCandidate(parsedLine)
      if (textCandidate === null) {
        continue
      }

      const embedded = this.parseCommandFromCommandJsonChunks(textCandidate)
      if (embedded !== null) {
        return embedded
      }
    }

    return null
  }

  parseCommandFromOutput(output: string): string | null {
    const fromCommandJsonChunks = this.parseCommandFromCommandJsonChunks(output)
    if (fromCommandJsonChunks !== null) {
      return fromCommandJsonChunks
    }

    return this.parseCommandFromJsonLines(output)
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

      if (terminated) {
        return
      }

      const parsedCommand = this.parseCommandFromOutput(accumulatedOutput)
      const stderrSnippet = this.formatStderrSnippet(accumulatedStderr)

      if (parsedCommand !== null) {
        listener({ type: "complete", command: parsedCommand })
      } else if (code !== null && code !== 0) {
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
      } else if (code === null) {
        const diagnostics = [
          signal
            ? `CLI exited due to signal ${signal}`
            : "CLI exited unexpectedly",
        ]
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
      const diagnostics = [`Failed to launch ${command}: ${err.message}`]
      const stderrSnippet = this.formatStderrSnippet(accumulatedStderr)
      if (stderrSnippet !== null) {
        diagnostics.push(`stderr: ${stderrSnippet}`)
      }
      listener({
        type: "error",
        message: diagnostics.join(" | "),
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
