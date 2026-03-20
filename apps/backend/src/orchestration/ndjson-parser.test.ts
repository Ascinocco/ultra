import { describe, expect, it } from "vitest"
import { parseAgentLine } from "./ndjson-parser.js"

describe("ndjson-parser", () => {
  it("parses a valid status event", () => {
    const result = parseAgentLine('{"type": "status", "summary": "working"}')
    expect(result).toEqual({ kind: "event", event: { type: "status", summary: "working" } })
  })

  it("parses a spawn_agent event", () => {
    const result = parseAgentLine(
      '{"type": "spawn_agent", "agent_type": "builder", "task": "implement X", "file_scope": ["src/x.ts"]}',
    )
    expect(result).toEqual({
      kind: "event",
      event: {
        type: "spawn_agent",
        agent_type: "builder",
        task: "implement X",
        file_scope: ["src/x.ts"],
      },
    })
  })

  it("returns log for non-JSON lines", () => {
    const result = parseAgentLine("Running tests...")
    expect(result).toEqual({ kind: "log", line: "Running tests..." })
  })

  it("returns log for JSON without type field", () => {
    const result = parseAgentLine('{"foo": "bar"}')
    expect(result).toEqual({ kind: "log", line: '{"foo": "bar"}' })
  })

  it("returns log for empty lines", () => {
    const result = parseAgentLine("")
    expect(result).toEqual({ kind: "log", line: "" })
  })
})
