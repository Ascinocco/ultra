import type { ChatRuntimeConfig } from "../chat-service.js"
import {
  buildSeededPrompt,
  createToolActivityEvent,
  extractTextCandidate,
  extractVendorSessionId,
  maybeBuildCheckpoint,
  randomRuntimeSessionId,
  stringifyUnknown,
} from "./runtime-helpers.js"
import type {
  ChatRuntimeAdapter,
  ChatRuntimeEvent,
  ChatRuntimeTurnRequest,
  ChatRuntimeTurnResult,
  RuntimeProcessRunner,
} from "./types.js"
import { ChatRuntimeError } from "./types.js"

function resolveClaudePermissionMode(
  permissionLevel: ChatRuntimeConfig["permissionLevel"],
): string {
  return permissionLevel === "full_access" ? "bypassPermissions" : "auto"
}

function buildClaudeArgs(request: ChatRuntimeTurnRequest): string[] {
  const permissionMode = resolveClaudePermissionMode(
    request.config.permissionLevel,
  )
  const seededPrompt = buildSeededPrompt(request)
  const baseArgs = [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--model",
    request.config.model,
    "--permission-mode",
    permissionMode,
  ]

  if (request.config.thinkingLevel !== "default") {
    baseArgs.push("--effort", request.config.thinkingLevel)
  }

  if (request.vendorSessionId) {
    return [...baseArgs, "--resume", request.vendorSessionId, seededPrompt]
  }

  return [...baseArgs, "--session-id", randomRuntimeSessionId(), seededPrompt]
}

function validateClaudeThinkingLevel(thinkingLevel: string): void {
  const supportedLevels = new Set(["default", "low", "medium", "high", "max"])

  if (!supportedLevels.has(thinkingLevel)) {
    throw new ChatRuntimeError(
      "invalid_config",
      `Claude adapter does not support thinking level '${thinkingLevel}'.`,
    )
  }
}

function parseClaudeLines(lines: string[]): {
  events: ChatRuntimeEvent[]
  finalText: string
  vendorSessionId: string | null
} {
  const events: ChatRuntimeEvent[] = []
  const deltas: string[] = []
  let finalText: string | null = null
  let vendorSessionId: string | null = null

  for (const line of lines) {
    let payload: unknown

    try {
      payload = JSON.parse(line)
    } catch {
      continue
    }

    vendorSessionId = extractVendorSessionId(payload) ?? vendorSessionId

    // Verbose stream-json wraps streaming events inside {"type":"stream_event","event":{...}}
    const record = payload as Record<string, unknown>
    const inner =
      record.type === "stream_event" &&
      typeof record.event === "object" &&
      record.event !== null
        ? (record.event as Record<string, unknown>)
        : record

    const payloadType =
      typeof inner.type === "string" ? (inner.type as string) : ""
    const text = extractTextCandidate(inner)
    const checkpoint = maybeBuildCheckpoint(payload)

    if (checkpoint) {
      events.push(
        createToolActivityEvent("Claude activity", {
          raw: payload as Record<string, unknown>,
        }),
      )
      events.push({
        type: "checkpoint_candidate",
        checkpoint,
      })
    }

    if (text) {
      if (payloadType.includes("delta")) {
        deltas.push(text)
        events.push({ type: "assistant_delta", text })
      } else if (payloadType === "result" || payloadType.includes("message")) {
        finalText = text
      }
    } else if (payloadType.length > 0) {
      events.push({
        type: "runtime_notice",
        message: stringifyUnknown(payload),
      })
    }
  }

  if (!finalText) {
    finalText = deltas.join("").trim()
  }

  return {
    events,
    finalText,
    vendorSessionId,
  }
}

export class ClaudeChatRuntimeAdapter implements ChatRuntimeAdapter {
  readonly provider = "claude" as const

  constructor(private readonly processRunner: RuntimeProcessRunner) {}

  async runTurn(
    request: ChatRuntimeTurnRequest,
  ): Promise<ChatRuntimeTurnResult> {
    validateClaudeThinkingLevel(request.config.thinkingLevel)

    const args = buildClaudeArgs(request)
    console.log(
      "[claude-runtime] spawning claude with args:",
      JSON.stringify(args),
    )

    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000

    const diagnostics = await this.processRunner.run({
      command: "claude",
      args,
      cwd: request.cwd,
      timeoutMs: FORTY_EIGHT_HOURS_MS,
      signal: request.signal,
    })

    console.log("[claude-runtime] exit code:", diagnostics.exitCode)
    console.log("[claude-runtime] timed out:", diagnostics.timedOut)
    console.log("[claude-runtime] signal:", diagnostics.signal)
    console.log(
      "[claude-runtime] stdout lines count:",
      diagnostics.stdoutLines.length,
    )
    console.log(
      "[claude-runtime] stderr preview:",
      diagnostics.stderr.slice(0, 500),
    )

    for (const [i, line] of diagnostics.stdoutLines.entries()) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        console.log(
          `[claude-runtime] line[${i}] type=${String(obj.type)} subtype=${String(obj.subtype ?? "")} keys=${Object.keys(obj).join(",")}`,
        )
      } catch {
        console.log(
          `[claude-runtime] line[${i}] (non-json): ${line.slice(0, 200)}`,
        )
      }
    }

    const parsed = parseClaudeLines(diagnostics.stdoutLines)

    console.log("[claude-runtime] parsed finalText length:", parsed.finalText.length)
    console.log(
      "[claude-runtime] parsed finalText preview:",
      parsed.finalText.slice(0, 200),
    )
    console.log("[claude-runtime] parsed events count:", parsed.events.length)
    console.log(
      "[claude-runtime] parsed vendorSessionId:",
      parsed.vendorSessionId,
    )

    if (diagnostics.timedOut) {
      throw new ChatRuntimeError(
        request.vendorSessionId ? "resume_failed" : "launch_failed",
        "Claude runtime timed out.",
        diagnostics,
      )
    }

    if (diagnostics.exitCode !== 0 && parsed.finalText.length === 0) {
      throw new ChatRuntimeError(
        request.vendorSessionId ? "resume_failed" : "unexpected_exit",
        diagnostics.stderr.trim() || "Claude exited without a final response.",
        diagnostics,
      )
    }

    if (parsed.finalText.length === 0) {
      throw new ChatRuntimeError(
        "empty_response",
        "Claude returned no assistant text.",
        diagnostics,
      )
    }

    return {
      events: [
        ...parsed.events,
        { type: "assistant_final", text: parsed.finalText },
      ],
      finalText: parsed.finalText,
      vendorSessionId: parsed.vendorSessionId ?? request.vendorSessionId,
      diagnostics,
      resumed: request.vendorSessionId !== null,
    }
  }
}
