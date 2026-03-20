import type { ChatSummary } from "@ultra/shared"
import { parseChatSnapshot, parseChatsListResult } from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command">

export async function loadChatsForProject(
  projectId: string,
  actions: Pick<AppActions, "setChatsFetchStatus" | "setChatsForProject">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  actions.setChatsFetchStatus(projectId, "loading")

  try {
    const result = await client.query("chats.list", { project_id: projectId })
    const { chats } = parseChatsListResult(result)
    actions.setChatsForProject(projectId, chats)
  } catch {
    actions.setChatsFetchStatus(projectId, "error")
  }
}

export async function createChat(
  projectId: string,
  actions: Pick<AppActions, "upsertChat">,
  client: WorkflowClient = ipcClient,
): Promise<ChatSummary> {
  const result = await client.command("chats.create", { project_id: projectId })
  const chat = parseChatSnapshot(result)
  actions.upsertChat(chat)
  return chat
}

export async function renameChat(
  chatId: string,
  title: string,
  actions: Pick<AppActions, "upsertChat">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.command("chats.rename", {
    chat_id: chatId,
    title,
  })
  const chat = parseChatSnapshot(result)
  actions.upsertChat(chat)
}

export type ChatRuntimeConfigUpdate = Pick<
  ChatSummary,
  "provider" | "model" | "thinkingLevel" | "permissionLevel"
>

export async function updateChatRuntimeConfig(
  chatId: string,
  config: ChatRuntimeConfigUpdate,
  actions: Pick<AppActions, "upsertChat">,
  client: WorkflowClient = ipcClient,
): Promise<ChatSummary> {
  const result = await client.command("chats.update_runtime_config", {
    chat_id: chatId,
    provider: config.provider,
    model: config.model,
    thinking_level: config.thinkingLevel,
    permission_level: config.permissionLevel,
  })
  const chat = parseChatSnapshot(result)
  actions.upsertChat(chat)
  return chat
}

export async function pinChat(
  chatId: string,
  actions: Pick<AppActions, "upsertChat">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.command("chats.pin", { chat_id: chatId })
  const chat = parseChatSnapshot(result)
  actions.upsertChat(chat)
}

export async function unpinChat(
  chatId: string,
  actions: Pick<AppActions, "upsertChat">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.command("chats.unpin", { chat_id: chatId })
  const chat = parseChatSnapshot(result)
  actions.upsertChat(chat)
}

export async function archiveChat(
  chatId: string,
  projectId: string,
  actions: Pick<AppActions, "removeChat">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("chats.archive", { chat_id: chatId })
  actions.removeChat(chatId, projectId)
}
