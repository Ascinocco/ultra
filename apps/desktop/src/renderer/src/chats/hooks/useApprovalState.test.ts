import { describe, expect, it } from "vitest"
import { deriveApprovalState } from "./useApprovalState.js"
import { makeChatMessage } from "../../test-utils/factories.js"

describe("deriveApprovalState", () => {
  const chatId = "chat_1"

  it("returns step 'plan' when no messages exist", () => {
    const result = deriveApprovalState([])
    expect(result.step).toBe("plan")
    expect(result.planApprovalMessageId).toBeNull()
    expect(result.specApprovalMessageId).toBeNull()
    expect(result.startRequestMessageId).toBeNull()
  })

  it("returns step 'plan' when only regular messages exist", () => {
    const messages = [
      makeChatMessage("m1", chatId, { messageType: "assistant_text" }),
      makeChatMessage("m2", chatId, { role: "user", messageType: "user_text" }),
    ]
    const result = deriveApprovalState(messages)
    expect(result.step).toBe("plan")
  })

  it("returns step 'specs' after plan approval", () => {
    const messages = [
      makeChatMessage("m1", chatId, { messageType: "assistant_text" }),
      makeChatMessage("m2", chatId, {
        role: "user",
        messageType: "plan_approval",
      }),
    ]
    const result = deriveApprovalState(messages)
    expect(result.step).toBe("specs")
    expect(result.planApprovalMessageId).toBe("m2")
  })

  it("returns step 'start' after plan and spec approval", () => {
    const messages = [
      makeChatMessage("m1", chatId, {
        role: "user",
        messageType: "plan_approval",
      }),
      makeChatMessage("m2", chatId, { messageType: "assistant_text" }),
      makeChatMessage("m3", chatId, {
        role: "user",
        messageType: "spec_approval",
      }),
    ]
    const result = deriveApprovalState(messages)
    expect(result.step).toBe("start")
    expect(result.planApprovalMessageId).toBe("m1")
    expect(result.specApprovalMessageId).toBe("m3")
  })

  it("returns step 'complete' when all three approvals exist in order", () => {
    const messages = [
      makeChatMessage("m1", chatId, {
        role: "user",
        messageType: "plan_approval",
      }),
      makeChatMessage("m2", chatId, {
        role: "user",
        messageType: "spec_approval",
      }),
      makeChatMessage("m3", chatId, {
        role: "user",
        messageType: "thread_start_request",
      }),
    ]
    const result = deriveApprovalState(messages)
    expect(result.step).toBe("complete")
    expect(result.startRequestMessageId).toBe("m3")
  })

  it("resets to 'specs' when a new plan approval follows a previous complete cycle", () => {
    const messages = [
      makeChatMessage("m1", chatId, {
        role: "user",
        messageType: "plan_approval",
      }),
      makeChatMessage("m2", chatId, {
        role: "user",
        messageType: "spec_approval",
      }),
      makeChatMessage("m3", chatId, {
        role: "user",
        messageType: "thread_start_request",
      }),
      makeChatMessage("m4", chatId, {
        role: "user",
        messageType: "plan_approval",
      }),
    ]
    const result = deriveApprovalState(messages)
    expect(result.step).toBe("specs")
    expect(result.planApprovalMessageId).toBe("m4")
    expect(result.specApprovalMessageId).toBeNull()
  })

  it("returns step 'plan' when spec_approval exists without plan_approval", () => {
    const messages = [
      makeChatMessage("m1", chatId, {
        role: "user",
        messageType: "spec_approval",
      }),
    ]
    const result = deriveApprovalState(messages)
    expect(result.step).toBe("plan")
  })

  it("returns step 'plan' when only thread_start_request exists without prior approvals", () => {
    const messages = [
      makeChatMessage("m1", chatId, {
        role: "user",
        messageType: "thread_start_request",
      }),
    ]
    const result = deriveApprovalState(messages)
    expect(result.step).toBe("plan")
  })
})
