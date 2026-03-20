// useStreamingText.ts
import { useMemo, useRef } from "react"
import type { ChatTurnEventSnapshot } from "@ultra/shared"

export interface StreamingTextState {
  streamingText: string | null
  isStreaming: boolean
}

/**
 * Pure function for testing. Derives streaming text from turn events.
 */
export function deriveStreamingText(
  events: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,
  messageCountAtTurnStart: number,
): StreamingTextState {
  const deltaText = events
    .filter((e) => e.eventType === "chat.turn_assistant_delta")
    .map((e) => (e.payload as { text: string }).text)
    .join("")

  if (inFlightTurn) {
    return { streamingText: deltaText, isStreaming: true }
  }

  // Turn ended — check if the final message has arrived
  if (deltaText.length > 0 && messageCount === messageCountAtTurnStart) {
    // Race condition: turn status updated but message not yet delivered
    return { streamingText: deltaText, isStreaming: false }
  }

  return { streamingText: null, isStreaming: false }
}

/**
 * React hook that derives streaming text from turn events in the store.
 */
export function useStreamingText(
  activeTurnEvents: ChatTurnEventSnapshot[],
  inFlightTurn: boolean,
  messageCount: number,
): StreamingTextState {
  const messageCountAtTurnStartRef = useRef(messageCount)
  const prevInFlightRef = useRef(false)

  // Capture message count when turn transitions from idle to in-flight
  if (inFlightTurn && !prevInFlightRef.current) {
    messageCountAtTurnStartRef.current = messageCount
  }
  prevInFlightRef.current = inFlightTurn

  return useMemo(
    () =>
      deriveStreamingText(
        activeTurnEvents,
        inFlightTurn,
        messageCount,
        messageCountAtTurnStartRef.current,
      ),
    [activeTurnEvents, inFlightTurn, messageCount],
  )
}
