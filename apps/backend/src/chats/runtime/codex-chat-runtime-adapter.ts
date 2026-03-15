import type { ChatRuntimeConfig } from "../chat-service.js"
import {
  buildSeededPrompt,
  createToolActivityEvent,
  extractTextCandidate,
  extractVendorSessionId,
  maybeBuildCheckpoint,
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

function resolveCodexSandbox(
  permissionLevel: ChatRuntimeConfig["permissionLevel"],
): string {
  return permissionLevel === "full_access"
    ? "danger-full-access"
    : "workspace-write"
}

function assertSupportedThinkingLevel(thinkingLevel: string): void {
  if (thinkingLevel !== "default") {
    throw new ChatRuntimeError(
      "invalid_config",
      `Codex adapter does not support thinking level '${thinkingLevel}' yet.`,
    )
  }
}

function buildArgs(request: ChatRuntimeTurnRequest): string[] {
  const sandbox = resolveCodexSandbox(request.config.permissionLevel)
  const seededPrompt = buildSeededPrompt(request)
  const baseArgs = ["-a", "never", "exec"]

  if (request.vendorSessionId) {
    return [
      ...baseArgs,
      "resume",
      request.vendorSessionId,
      "--json",
      "-C",
      request.cwd,
      "-m",
      request.config.model,
      "-s",
      sandbox,
      seededPrompt,
    ]
  }

  return [
    ...baseArgs,
    "--json",
    "-C",
    request.cwd,
    "-m",
    request.config.model,
    "-s",
    sandbox,
    seededPrompt,
  ]
}

function parseCodexLines(lines: string[]): {
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
    const payloadType =
      typeof (payload as Record<string, unknown>).type === "string"
        ? ((payload as Record<string, unknown>).type as string)
        : ""
    const text = extractTextCandidate(payload)
    const checkpoint = maybeBuildCheckpoint(payload)

    if (checkpoint) {
      events.push(
        createToolActivityEvent("Codex activity", {
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
      } else {
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

export class CodexChatRuntimeAdapter implements ChatRuntimeAdapter {
  readonly provider = "codex" as const

  constructor(private readonly processRunner: RuntimeProcessRunner) {}

  async runTurn(
    request: ChatRuntimeTurnRequest,
  ): Promise<ChatRuntimeTurnResult> {
    assertSupportedThinkingLevel(request.config.thinkingLevel)

    const diagnostics = await this.processRunner.run({
      command: "codex",
      args: buildArgs(request),
      cwd: request.cwd,
    })
    const parsed = parseCodexLines(diagnostics.stdoutLines)

    if (diagnostics.timedOut) {
      throw new ChatRuntimeError(
        request.vendorSessionId ? "resume_failed" : "launch_failed",
        "Codex runtime timed out.",
        diagnostics,
      )
    }

    if (diagnostics.exitCode !== 0 && parsed.finalText.length === 0) {
      throw new ChatRuntimeError(
        request.vendorSessionId ? "resume_failed" : "unexpected_exit",
        diagnostics.stderr.trim() || "Codex exited without a final response.",
        diagnostics,
      )
    }

    if (parsed.finalText.length === 0) {
      throw new ChatRuntimeError(
        "empty_response",
        "Codex returned no assistant text.",
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
