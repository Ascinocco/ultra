import { describe, expect, it, vi } from "vitest"

import { makeChatMessage } from "../test-utils/factories.js"
import {
  fetchChatMessages,
  sendChatMessage,
  subscribeToChatMessages,
} from "./chat-message-workflows.js"

function createMockClient(responses: Record<string, unknown>) {
  return {
    query: vi.fn(async (name: string) => responses[name]),
    command: vi.fn(async (name: string) => responses[name]),
    subscribe: vi.fn(),
  }
}

describe("fetchChatMessages", () => {
  it("loads chat transcript history and updates fetch status", async () => {
    const messages = [
      makeChatMessage("chat_msg_1", "chat_1", { role: "user" }),
      makeChatMessage("chat_msg_2", "chat_1", { role: "assistant" }),
    ]
    const client = createMockClient({
      "chats.get_messages": { messages },
    })
    const actions = {
      setMessagesForChat: vi.fn(),
      setChatMessagesFetchStatus: vi.fn(),
    }

    await fetchChatMessages("chat_1", actions, client)

    expect(actions.setChatMessagesFetchStatus).toHaveBeenCalledWith(
      "chat_1",
      "loading",
    )
    expect(client.query).toHaveBeenCalledWith("chats.get_messages", {
      chat_id: "chat_1",
    })
    expect(actions.setMessagesForChat).toHaveBeenCalledWith("chat_1", messages)
  })
})

describe("sendChatMessage", () => {
  it("sends a prompt and upserts returned user/assistant messages", async () => {
    const userMessage = makeChatMessage("chat_msg_user", "chat_1", {
      role: "user",
      messageType: "user_text",
      contentMarkdown: "Outline next steps.",
    })
    const assistantMessage = makeChatMessage("chat_msg_assistant", "chat_1", {
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Here are next steps.",
    })
    const client = createMockClient({
      "chats.send_message": {
        userMessage,
        assistantMessage,
        checkpointIds: ["chat_checkpoint_1"],
      },
    })
    const actions = {
      upsertChatMessage: vi.fn(),
    }

    const result = await sendChatMessage(
      "chat_1",
      "Outline next steps.",
      actions,
      client,
    )

    expect(client.command).toHaveBeenCalledWith("chats.send_message", {
      chat_id: "chat_1",
      prompt: "Outline next steps.",
    })
    expect(actions.upsertChatMessage).toHaveBeenCalledWith("chat_1", userMessage)
    expect(actions.upsertChatMessage).toHaveBeenCalledWith(
      "chat_1",
      assistantMessage,
    )
    expect(result.userMessage.id).toBe("chat_msg_user")
    expect(result.assistantMessage.id).toBe("chat_msg_assistant")
  })
})

describe("subscribeToChatMessages", () => {
  it("subscribes to chats.messages and routes parsed events into store updates", async () => {
    let capturedListener: ((event: unknown) => void) | null = null
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi
        .fn()
        .mockImplementation((_name, _payload, listener) => {
          capturedListener = listener
          return Promise.resolve(unsubscribe)
        }),
    }
    const actions = {
      upsertChatMessage: vi.fn(),
    }

    const result = await subscribeToChatMessages("chat_1", actions, client)

    expect(client.subscribe).toHaveBeenCalledWith(
      "chats.messages",
      { chat_id: "chat_1" },
      expect.any(Function),
    )

    capturedListener?.({
      protocol_version: "1.0",
      type: "event",
      subscription_id: "sub_chat_1",
      event_name: "chats.messages",
      payload: makeChatMessage("chat_msg_live", "chat_1", {
        role: "assistant",
      }),
    })

    expect(actions.upsertChatMessage).toHaveBeenCalledWith(
      "chat_1",
      expect.objectContaining({ id: "chat_msg_live" }),
    )
    expect(result).toBe(unsubscribe)
  })
})
