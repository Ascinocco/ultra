import type {
  ChatMessageSnapshot,
  ChatsGetTurnEventsResult,
  ChatsListTurnsResult,
  ChatsStartTurnResult,
  ChatTurnEventSnapshot,
  ChatTurnSnapshot,
  ThreadDetailResult,
} from "@ultra/shared"
import {
  parseChatMessageSnapshot,
  parseChatsGetMessagesResult,
  parseChatsGetTurnEventsResult,
  parseChatsListTurnsResult,
  parseChatsMessagesEvent,
  parseChatsStartTurnResult,
  parseChatsTurnEventsEvent,
  parseChatTurnSnapshot,
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

type StartChatTurnActions = Pick<
  AppActions,
  "setChatTurnSendState" | "upsertChatTurn" | "setActiveChatTurn"
>

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createClientTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `renderer_turn_${globalThis.crypto.randomUUID()}`
  }
  return `renderer_turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function startChatTurn(
  chatId: string,
  prompt: string,
  actions: StartChatTurnActions,
  client: WorkflowClient = ipcClient,
): Promise<ChatsStartTurnResult> {
  actions.setChatTurnSendState(chatId, "starting")

  try {
    const result = await client.command("chats.start_turn", {
      chat_id: chatId,
      prompt,
      client_turn_id: createClientTurnId(),
    })
    const parsed = parseChatsStartTurnResult(result)
    actions.upsertChatTurn(chatId, parsed.turn)
    actions.setActiveChatTurn(chatId, parsed.turn.turnId)
    actions.setChatTurnSendState(chatId, "idle")
    return parsed
  } catch (error) {
    actions.setChatTurnSendState(chatId, "error", getErrorMessage(error))
    throw error
  }
}

type FetchChatTurnsActions = Pick<
  AppActions,
  "setTurnsForChat" | "setChatTurnsFetchStatus"
>

export async function fetchChatTurns(
  chatId: string,
  actions: FetchChatTurnsActions,
  client: WorkflowClient = ipcClient,
): Promise<ChatsListTurnsResult> {
  actions.setChatTurnsFetchStatus(chatId, "loading")

  try {
    const result = await client.query("chats.list_turns", {
      chat_id: chatId,
    })
    const parsed = parseChatsListTurnsResult(result)
    actions.setTurnsForChat(chatId, parsed.turns)
    return parsed
  } catch (error) {
    actions.setChatTurnsFetchStatus(chatId, "error")
    throw error
  }
}

type FetchChatTurnActions = Pick<AppActions, "upsertChatTurn">

export async function fetchChatTurn(
  chatId: string,
  turnId: string,
  actions: FetchChatTurnActions,
  client: WorkflowClient = ipcClient,
): Promise<ChatTurnSnapshot> {
  const result = await client.query("chats.get_turn", {
    chat_id: chatId,
    turn_id: turnId,
  })
  const parsed = parseChatTurnSnapshot(result)
  actions.upsertChatTurn(chatId, parsed)
  return parsed
}

type ReplayChatTurnEventsActions = Pick<AppActions, "appendChatTurnEvent">

export async function replayChatTurnEvents(
  chatId: string,
  turnId: string,
  actions: ReplayChatTurnEventsActions,
  fromSequence?: number,
  client: WorkflowClient = ipcClient,
): Promise<ChatsGetTurnEventsResult> {
  const result = await client.query("chats.get_turn_events", {
    chat_id: chatId,
    turn_id: turnId,
    ...(fromSequence && fromSequence > 0
      ? { from_sequence: fromSequence }
      : {}),
  })
  const parsed = parseChatsGetTurnEventsResult(result)

  for (const event of parsed.events) {
    actions.appendChatTurnEvent(event)
  }

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

type SubscribeChatTurnEventsActions = Pick<AppActions, "appendChatTurnEvent">

export async function subscribeToChatTurnEvents(
  input: { chatId: string; turnId?: string },
  actions: SubscribeChatTurnEventsActions,
  onEvent?: (event: ChatTurnEventSnapshot) => void,
  client: WorkflowClient = ipcClient,
): Promise<() => Promise<void>> {
  return client.subscribe(
    "chats.turn_events",
    {
      chat_id: input.chatId,
      ...(input.turnId ? { turn_id: input.turnId } : {}),
    },
    (event) => {
      const parsed = parseChatsTurnEventsEvent(event)
      actions.appendChatTurnEvent(parsed.payload)
      onEvent?.(parsed.payload)
    },
  )
}

export function selectCurrentTurn(
  turns: ChatTurnSnapshot[],
): ChatTurnSnapshot | null {
  return (
    turns.find(
      (turn) => turn.status === "queued" || turn.status === "running",
    ) ??
    turns[0] ??
    null
  )
}
