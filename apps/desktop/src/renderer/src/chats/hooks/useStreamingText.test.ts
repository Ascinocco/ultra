// useStreamingText.test.ts
import { describe, expect, it } from "vitest"
import { deriveStreamingText } from "./useStreamingText.js"
import type { ChatTurnEventSnapshot } from "@ultra/shared"

function makeDeltaEvent(
  sequenceNumber: number,
  text: string,
): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${sequenceNumber}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber,
    eventType: "chat.turn_assistant_delta",
    source: "runtime",
    actorType: "assistant",
    actorId: null,
    payload: { text },
    occurredAt: "2026-03-19T00:00:00Z",
    recordedAt: "2026-03-19T00:00:00Z",
  }
}

function makeNonDeltaEvent(sequenceNumber: number): ChatTurnEventSnapshot {
  return {
    eventId: `evt_${sequenceNumber}`,
    chatId: "chat_1",
    turnId: "turn_1",
    sequenceNumber,
    eventType: "chat.turn_started",
    source: "system",
    actorType: "system",
    actorId: null,
    payload: {},
    occurredAt: "2026-03-19T00:00:00Z",
    recordedAt: "2026-03-19T00:00:00Z",
  }
}

describe("deriveStreamingText", () => {
  it("returns null when turn is not in flight", () => {
    const result = deriveStreamingText([], false, 0, 0)
    expect(result.streamingText).toBeNull()
    expect(result.isStreaming).toBe(false)
  })

  it("returns empty string when turn is active but no deltas yet", () => {
    const events = [makeNonDeltaEvent(1)]
    const result = deriveStreamingText(events, true, 0, 0)
    expect(result.streamingText).toBe("")
    expect(result.isStreaming).toBe(true)
  })

  it("accumulates delta text from events", () => {
    const events = [
      makeNonDeltaEvent(1),
      makeDeltaEvent(2, "Hello"),
      makeDeltaEvent(3, " world"),
    ]
    const result = deriveStreamingText(events, true, 0, 0)
    expect(result.streamingText).toBe("Hello world")
    expect(result.isStreaming).toBe(true)
  })

  it("keeps showing text when turn ends but final message not yet arrived", () => {
    const events = [
      makeDeltaEvent(1, "Hello"),
      makeDeltaEvent(2, " world"),
    ]
    // inFlightTurn is false, but messageCount unchanged (no new message yet)
    const result = deriveStreamingText(events, false, 5, 5)
    expect(result.streamingText).toBe("Hello world")
    expect(result.isStreaming).toBe(false)
  })

  it("returns null when turn ends and final message has arrived", () => {
    const events = [
      makeDeltaEvent(1, "Hello"),
    ]
    // messageCount increased = final message arrived
    const result = deriveStreamingText(events, false, 6, 5)
    expect(result.streamingText).toBeNull()
    expect(result.isStreaming).toBe(false)
  })

  it("ignores non-delta events when accumulating text", () => {
    const events = [
      makeNonDeltaEvent(1),
      makeDeltaEvent(2, "Only"),
      makeNonDeltaEvent(3),
      makeDeltaEvent(4, " this"),
    ]
    const result = deriveStreamingText(events, true, 0, 0)
    expect(result.streamingText).toBe("Only this")
  })
})
