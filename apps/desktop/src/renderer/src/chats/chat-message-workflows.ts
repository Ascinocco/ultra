import type { ChatsSendMessageResult } from "@ultra/shared"
import {
  parseChatsGetMessagesResult,
  parseChatsMessagesEvent,
  parseChatsSendMessageResult,
} from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command" | "subscribe">

type FetchChatMessagesActions = Pick<
  AppActions,
  "setMessagesForChat" | "setChatMessagesFetchStatus"
>

export async function fetchChatMessages(
  chatId: string,
  actions: FetchChatMessagesActions,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  actions.setChatMessagesFetchStatus(chatId, "loading")
  try {
    const result = await client.query("chats.get_messages", {
      chat_id: chatId,
    })
    const { messages } = parseChatsGetMessagesResult(result)
    actions.setMessagesForChat(chatId, messages)
  } catch (err) {
    actions.setChatMessagesFetchStatus(chatId, "error")
    throw err
  }
}

type SendChatMessageActions = Pick<AppActions, "upsertChatMessage">

export async function sendChatMessage(
  chatId: string,
  prompt: string,
  actions: SendChatMessageActions,
  client: WorkflowClient = ipcClient,
): Promise<ChatsSendMessageResult> {
  const result = await client.command("chats.send_message", {
    chat_id: chatId,
    prompt,
  })
  const parsed = parseChatsSendMessageResult(result)
  actions.upsertChatMessage(chatId, parsed.userMessage)
  actions.upsertChatMessage(chatId, parsed.assistantMessage)
  return parsed
}

type SubscribeChatMessagesActions = Pick<AppActions, "upsertChatMessage">

export async function subscribeToChatMessages(
  chatId: string,
  actions: SubscribeChatMessagesActions,
  client: WorkflowClient = ipcClient,
): Promise<() => Promise<void>> {
  return client.subscribe("chats.messages", { chat_id: chatId }, (event) => {
    const parsed = parseChatsMessagesEvent(event)
    actions.upsertChatMessage(parsed.payload.chatId, parsed.payload)
  })
}
