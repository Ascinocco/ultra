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

export type StartChatTurnRuntimeConfig = {
  provider: "claude" | "codex"
  model: string
  thinkingLevel: string
  permissionLevel: "supervised" | "full_access"
}

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
  runtimeConfig?: StartChatTurnRuntimeConfig,
  attachments?: Array<{ type: "image" | "text"; name: string; media_type: string; data: string }>,
): Promise<ChatsStartTurnResult> {
  actions.setChatTurnSendState(chatId, "starting")

  try {
    if (runtimeConfig) {
      await client.command("chats.update_runtime_config", {
        chat_id: chatId,
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        thinking_level: runtimeConfig.thinkingLevel,
        permission_level: runtimeConfig.permissionLevel,
      })
    }

    const result = await client.command("chats.start_turn", {
      chat_id: chatId,
      prompt,
      client_turn_id: createClientTurnId(),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
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

export async function cancelChatTurn(
  chatId: string,
  turnId: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("chats.cancel_turn", {
    chat_id: chatId,
    turn_id: turnId,
  })
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

type SubscribeChatTurnEventsActions = Pick<
  AppActions,
  "appendChatTurnEvent" | "updateChatTurnStatus"
>

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

      const { eventType, chatId } = parsed.payload
      if (eventType === "chat.turn_queued" || eventType === "chat.turn_started") {
        actions.updateChatTurnStatus(chatId, "running")
      } else if (eventType === "chat.turn_completed") {
        actions.updateChatTurnStatus(chatId, "waiting_for_input")
      } else if (eventType === "chat.turn_failed") {
        actions.updateChatTurnStatus(chatId, "error")
      }

      onEvent?.(parsed.payload)
    },
  )
}

export function gatherPromoteContext(messages: ChatMessageSnapshot[]): string[] {
  const markerTypes = new Set(["plan_marker_open", "plan_marker_close"])

  let lastOpenIndex = -1
  let lastCloseIndex = -1

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (lastCloseIndex === -1 && msg.messageType === "plan_marker_close") {
      lastCloseIndex = i
    }
    if (lastOpenIndex === -1 && msg.messageType === "plan_marker_open") {
      lastOpenIndex = i
      break
    }
  }

  let ids: string[]

  if (lastOpenIndex !== -1 && lastCloseIndex !== -1 && lastCloseIndex > lastOpenIndex) {
    // Matched open+close pair: return IDs between them (exclusive)
    ids = messages
      .slice(lastOpenIndex + 1, lastCloseIndex)
      .filter((m) => !markerTypes.has(m.messageType))
      .map((m) => m.id)
  } else if (lastOpenIndex !== -1 && (lastCloseIndex === -1 || lastCloseIndex < lastOpenIndex)) {
    // Unclosed open marker: return IDs from after open to end
    ids = messages
      .slice(lastOpenIndex + 1)
      .filter((m) => !markerTypes.has(m.messageType))
      .map((m) => m.id)
  } else {
    // No markers: find last thread_start_request
    let lastStartIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.messageType === "thread_start_request") {
        lastStartIndex = i
        break
      }
    }

    if (lastStartIndex !== -1) {
      ids = messages
        .slice(lastStartIndex + 1)
        .filter((m) => !markerTypes.has(m.messageType))
        .map((m) => m.id)
    } else {
      ids = messages
        .filter((m) => !markerTypes.has(m.messageType))
        .map((m) => m.id)
    }
  }

  return ids
}

export async function promoteToThread(
  chatId: string,
  title: string,
  contextMessageIds: string[],
  client: WorkflowClient = ipcClient,
): Promise<ThreadDetailResult> {
  const result = await client.command("chats.promote_to_thread", {
    chat_id: chatId,
    title,
    context_message_ids: contextMessageIds,
  })
  return parseThreadDetailResult(result)
}

export async function createPlanMarker(
  chatId: string,
  markerType: "open" | "close",
  actions: Pick<AppActions, "upsertChatMessage">,
  client: WorkflowClient = ipcClient,
): Promise<ChatMessageSnapshot> {
  const result = await client.command("chats.create_plan_marker", {
    chat_id: chatId,
    marker_type: markerType,
  })
  const marker = parseChatMessageSnapshot(result)
  actions.upsertChatMessage(chatId, marker)
  return marker
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
