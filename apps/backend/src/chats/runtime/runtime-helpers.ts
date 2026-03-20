import { randomUUID } from "node:crypto"

import type { ChatMessageSnapshot } from "../chat-service.js"
import type {
  ChatRuntimeCheckpointCandidate,
  ChatRuntimeEvent,
  ChatRuntimeTurnRequest,
} from "./types.js"

type JsonRecord = Record<string, unknown>

const SESSION_ID_KEYS = [
  "session_id",
  "sessionId",
  "conversation_id",
  "conversationId",
]

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null
}

export function randomRuntimeSessionId(): string {
  return randomUUID()
}

export function buildSeededPrompt(request: ChatRuntimeTurnRequest): string {
  if (!request.vendorSessionId) {
    const transcript = buildTranscriptReplay(
      request.seedMessages,
      request.continuationPrompt,
    )

    if (transcript) {
      return `${transcript}\n\nNew user request:\n${request.prompt}`
    }
  }

  return request.prompt
}

function buildTranscriptReplay(
  seedMessages: ChatMessageSnapshot[],
  continuationPrompt: string | null,
): string | null {
  if (continuationPrompt && continuationPrompt.trim().length > 0) {
    return continuationPrompt.trim()
  }

  const relevantMessages = seedMessages
    .filter(
      (message) =>
        message.messageType === "user_text" ||
        message.messageType === "assistant_text",
    )
    .slice(-10)

  if (relevantMessages.length === 0) {
    return null
  }

  const transcript = relevantMessages
    .map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User"
      return `${speaker}: ${message.contentMarkdown ?? ""}`.trim()
    })
    .join("\n")

  return `You are resuming an Ultra chat. Continue from this prior transcript context:\n${transcript}`
}

export function buildContinuationPromptFromMessages(
  seedMessages: ChatMessageSnapshot[],
): string | null {
  return buildTranscriptReplay(seedMessages, null)
}

export function findFirstStringByKeys(
  input: unknown,
  keys: string[],
): string | null {
  if (!isRecord(input)) {
    return null
  }

  for (const key of keys) {
    if (typeof input[key] === "string" && input[key].trim().length > 0) {
      return input[key] as string
    }
  }

  for (const value of Object.values(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstStringByKeys(item, keys)
        if (found) {
          return found
        }
      }
      continue
    }

    const found = findFirstStringByKeys(value, keys)
    if (found) {
      return found
    }
  }

  return null
}

export function extractVendorSessionId(input: unknown): string | null {
  return findFirstStringByKeys(input, SESSION_ID_KEYS)
}

export function extractTextCandidate(input: unknown): string | null {
  if (!isRecord(input)) {
    return null
  }

  const candidateKeys = ["text", "delta", "content", "message", "result"]

  for (const key of candidateKeys) {
    if (typeof input[key] === "string" && input[key].trim().length > 0) {
      return input[key] as string
    }
  }

  if (isRecord(input.delta) && typeof input.delta.text === "string") {
    return input.delta.text
  }

  if (Array.isArray(input.content)) {
    const parts = input.content
      .map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .filter((text) => text.length > 0)
    if (parts.length > 0) {
      return parts.join("")
    }
  }

  for (const value of Object.values(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = extractTextCandidate(item)
        if (found) {
          return found
        }
      }
      continue
    }

    const found = extractTextCandidate(value)
    if (found) {
      return found
    }
  }

  return null
}

export function stringifyUnknown(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

export function maybeBuildCheckpoint(
  input: unknown,
): ChatRuntimeCheckpointCandidate | null {
  if (!isRecord(input)) {
    return null
  }

  const actionType =
    typeof input.action_type === "string"
      ? input.action_type
      : typeof input.actionType === "string"
        ? input.actionType
        : typeof input.tool === "string"
          ? "tool_activity"
          : typeof input.command === "string"
            ? "command_execution"
            : null

  if (!actionType) {
    return null
  }

  const affectedPaths = Array.isArray(input.paths)
    ? input.paths.filter((value): value is string => typeof value === "string")
    : Array.isArray(input.affected_paths)
      ? input.affected_paths.filter(
          (value): value is string => typeof value === "string",
        )
      : typeof input.path === "string"
        ? [input.path]
        : []

  const resultSummary =
    typeof input.summary === "string"
      ? input.summary
      : typeof input.result === "string"
        ? input.result
        : null

  const commandMetadata = isRecord(input.command_metadata)
    ? input.command_metadata
    : typeof input.command === "string"
      ? { command: input.command }
      : null

  return {
    actionType,
    affectedPaths,
    resultSummary,
    commandMetadata,
  }
}

export function createToolActivityEvent(
  label: string,
  metadata?: Record<string, unknown>,
): ChatRuntimeEvent {
  if (!metadata) {
    return {
      type: "tool_activity",
      label,
    }
  }

  return {
    type: "tool_activity",
    label,
    metadata,
  }
}
