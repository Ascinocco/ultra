import type {
  ChatMessageSnapshot,
  ChatsSendMessageResult,
  ThreadDetailResult,
} from "@ultra/shared"
import {
  parseChatMessageSnapshot,
  parseChatsGetMessagesResult,
  parseChatsMessagesEvent,
  parseChatsSendMessageResult,
  parseThreadDetailResult,
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

type ApprovalActions = Pick<AppActions, "upsertChatMessage">

export async function approvePlan(
  chatId: string,
  actions: ApprovalActions,
  client: WorkflowClient = ipcClient,
): Promise<ChatMessageSnapshot> {
  const result = await client.command("chats.approve_plan", {
    chat_id: chatId,
  })
  const approval = parseChatMessageSnapshot(result)
  actions.upsertChatMessage(chatId, approval)
  return approval
}

export async function approveSpecs(
  chatId: string,
  actions: ApprovalActions,
  client: WorkflowClient = ipcClient,
): Promise<ChatMessageSnapshot> {
  const result = await client.command("chats.approve_specs", {
    chat_id: chatId,
  })
  const approval = parseChatMessageSnapshot(result)
  actions.upsertChatMessage(chatId, approval)
  return approval
}

type StartThreadFromChatClient = Pick<typeof ipcClient, "command">

export async function startThreadFromChat(
  input: {
    chatId: string
    title: string
    summary?: string | null
    planApprovalMessageId: string
    specApprovalMessageId: string
    startRequestMessageId?: string
    confirmStart?: boolean
  },
  client: StartThreadFromChatClient = ipcClient,
): Promise<ThreadDetailResult> {
  const payload: Record<string, unknown> = {
    chat_id: input.chatId,
    title: input.title,
    summary: input.summary ?? null,
    plan_approval_message_id: input.planApprovalMessageId,
    spec_approval_message_id: input.specApprovalMessageId,
    spec_refs: [],
    ticket_refs: [],
  }

  if (input.startRequestMessageId) {
    payload.start_request_message_id = input.startRequestMessageId
  } else {
    payload.confirm_start = input.confirmStart ?? true
  }

  const result = await client.command("chats.start_thread", payload)
  return parseThreadDetailResult(result)
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
