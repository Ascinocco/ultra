export type AgentEventType = "status" | "spawn_agent" | "agent_message" | "agent_done"

export type AgentEvent = {
  type: AgentEventType
  [key: string]: unknown
}

export type ParseResult =
  | { kind: "event"; event: AgentEvent }
  | { kind: "log"; line: string }

const KNOWN_TYPES = new Set<string>(["status", "spawn_agent", "agent_message", "agent_done"])

export function parseAgentLine(line: string): ParseResult {
  if (line.length === 0 || line[0] !== "{") {
    return { kind: "log", line }
  }

  try {
    const parsed = JSON.parse(line)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.type === "string" &&
      KNOWN_TYPES.has(parsed.type)
    ) {
      return { kind: "event", event: parsed as AgentEvent }
    }
  } catch {
    // Not valid JSON — treat as log
  }

  return { kind: "log", line }
}
