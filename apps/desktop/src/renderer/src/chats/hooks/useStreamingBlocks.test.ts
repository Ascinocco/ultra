// useStreamingBlocks.test.ts
import { describe, expect, it } from "vitest"
import { deriveStreamingBlocks } from "./useStreamingBlocks.js"
import type { ChatTurnEventSnapshot } from "@ultra/shared"

function makeDeltaEvent(seq: number, text: string): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${seq}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber: seq,
    eventType: "chat.turn_assistant_delta",
    source: "runtime",
    actorType: "assistant",
    actorId: null,
    payload: { text },
    occurredAt: "2026-03-20T00:00:00Z",
    recordedAt: "2026-03-20T00:00:00Z",
  }
}

function makeToolEvent(seq: number, label: string, metadata: any = {}): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${seq}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber: seq,
    eventType: "chat.turn_progress",
    source: "runtime",
    actorType: "assistant",
    actorId: null,
    payload: { stage: "tool_activity", label, metadata },
    occurredAt: "2026-03-20T00:00:00Z",
    recordedAt: "2026-03-20T00:00:00Z",
  }
}

function makeNonRelevantEvent(seq: number): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${seq}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber: seq,
    eventType: "chat.turn_started",
    source: "system",
    actorType: "system",
    actorId: null,
    payload: {},
    occurredAt: "2026-03-20T00:00:00Z",
    recordedAt: "2026-03-20T00:00:00Z",
  }
}

describe("deriveStreamingBlocks", () => {
  it("returns null when turn is not in flight and no deltas", () => {
    const result = deriveStreamingBlocks([], false, 0, 0)
    expect(result.blocks).toBeNull()
  })

  it("returns text block from assistant deltas", () => {
    const events = [makeDeltaEvent(1, "Hello"), makeDeltaEvent(2, " world")]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks![0]).toEqual({ type: "text", content: "Hello world" })
  })

  it("returns tool_group block from tool events", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1", input: { command: "ls" } }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks![0].type).toBe("tool_group")
    const group = result.blocks![0] as any
    expect(group.tools).toHaveLength(1)
    expect(group.tools[0].toolName).toBe("bash")
    expect(group.tools[0].detail).toBe("ls")
    expect(group.tools[0].status).toBe("running")
  })

  it("interleaves text and tool groups", () => {
    const events = [
      makeDeltaEvent(1, "Looking at files..."),
      makeToolEvent(2, "Read", { id: "t1", input: { file_path: "/app/index.ts" } }),
      makeToolEvent(3, "Read", { id: "t2", input: { file_path: "/app/main.ts" } }),
      makeDeltaEvent(4, "Here is what I found."),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(3)
    expect(result.blocks![0].type).toBe("text")
    expect(result.blocks![1].type).toBe("tool_group")
    expect(result.blocks![2].type).toBe("text")
  })

  it("auto-collapses tool group when text follows", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1" }),
      makeDeltaEvent(2, "Done."),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.collapsed).toBe(true)
    expect(group.tools[0].status).toBe("done")
  })

  it("keeps tool group expanded when no text follows (still running)", () => {
    const events = [
      makeDeltaEvent(1, "Let me check..."),
      makeToolEvent(2, "bash", { id: "t1" }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![1] as any
    expect(group.collapsed).toBe(false)
    expect(group.tools[0].status).toBe("running")
  })

  it("deduplicates tool entries by id", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1" }),
      makeToolEvent(2, "bash", { id: "t1", input: { command: "ls" } }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.tools).toHaveLength(1)
    expect(group.tools[0].detail).toBe("ls")
    expect(group.tools[0].status).toBe("done")
  })

  it("filters out command_output events", () => {
    const events = [
      makeToolEvent(1, "bash", { id: "t1" }),
      makeToolEvent(2, "command_output", {}),
      makeToolEvent(3, "command_output", {}),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.tools).toHaveLength(1)
  })

  it("handles unknown tools with generic fallback", () => {
    const events = [
      makeToolEvent(1, "SomeNewTool", { id: "t1", foo: "bar" }),
    ]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    const group = result.blocks![0] as any
    expect(group.tools[0].icon).toBe("tool")
    expect(group.tools[0].toolName).toBe("SomeNewTool")
  })

  it("keeps blocks visible during race condition (turn ended but message not arrived)", () => {
    const events = [makeDeltaEvent(1, "Hello")]
    const result = deriveStreamingBlocks(events, false, 5, 5)
    expect(result.blocks).not.toBeNull()
  })

  it("returns null when turn ended and message arrived", () => {
    const events = [makeDeltaEvent(1, "Hello")]
    const result = deriveStreamingBlocks(events, false, 6, 5)
    expect(result.blocks).toBeNull()
  })

  it("ignores non-relevant events", () => {
    const events = [makeNonRelevantEvent(1), makeDeltaEvent(2, "Hi")]
    const result = deriveStreamingBlocks(events, true, 0, 0)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks![0].type).toBe("text")
  })
})
