import { useMemo } from "react"
import type { ChatMessageSnapshot } from "@ultra/shared"

export type ApprovalStep = "plan" | "specs" | "start" | "complete"

export interface ApprovalState {
  step: ApprovalStep
  planApprovalMessageId: string | null
  specApprovalMessageId: string | null
  startRequestMessageId: string | null
}

export function deriveApprovalState(
  messages: ChatMessageSnapshot[],
): ApprovalState {
  let planIdx = -1
  let specIdx = -1
  let startIdx = -1
  let planId: string | null = null
  let specId: string | null = null
  let startId: string | null = null

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.messageType === "plan_approval" && planIdx === -1) {
      planIdx = i
      planId = m.id
    } else if (m.messageType === "spec_approval" && specIdx === -1) {
      specIdx = i
      specId = m.id
    } else if (m.messageType === "thread_start_request" && startIdx === -1) {
      startIdx = i
      startId = m.id
    }
    if (planIdx !== -1 && specIdx !== -1 && startIdx !== -1) break
  }

  if (planIdx === -1) {
    return { step: "plan", planApprovalMessageId: null, specApprovalMessageId: null, startRequestMessageId: null }
  }
  if (specIdx === -1 || specIdx <= planIdx) {
    return { step: "specs", planApprovalMessageId: planId, specApprovalMessageId: null, startRequestMessageId: null }
  }
  if (startIdx === -1 || startIdx <= specIdx) {
    return { step: "start", planApprovalMessageId: planId, specApprovalMessageId: specId, startRequestMessageId: null }
  }
  return { step: "complete", planApprovalMessageId: planId, specApprovalMessageId: specId, startRequestMessageId: startId }
}

export function useApprovalState(
  messages: ChatMessageSnapshot[] | undefined,
): ApprovalState {
  return useMemo(
    () => deriveApprovalState(messages ?? []),
    [messages],
  )
}
