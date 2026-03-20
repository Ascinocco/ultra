import type { ThreadEventSnapshot, ThreadMessageSnapshot } from "@ultra/shared"
import {
  parseThreadsGetEventsResult,
  parseThreadsGetMessagesResult,
  parseThreadsListResult,
  parseThreadsMessagesEvent,
  parseThreadsSendMessageResult,
} from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command" | "subscribe">

type FetchThreadsActions = Pick<
  AppActions,
  "setThreadsForProject" | "setThreadFetchStatus"
>

export async function fetchThreads(
  projectId: string,
  actions: FetchThreadsActions,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  actions.setThreadFetchStatus(projectId, "loading")
  try {
    const result = await client.query("threads.list_by_project", {
      project_id: projectId,
    })
    const { threads } = parseThreadsListResult(result)
    actions.setThreadsForProject(projectId, threads)
  } catch (err) {
    actions.setThreadFetchStatus(projectId, "error")
    throw err
  }
}

export async function fetchThreadEvents(
  threadId: string,
  client: WorkflowClient = ipcClient,
): Promise<ThreadEventSnapshot[]> {
  const result = await client.query("threads.get_events", {
    thread_id: threadId,
  })
  const { events } = parseThreadsGetEventsResult(result)
  return events
}

type FetchMessagesActions = Pick<AppActions, "setMessagesForThread">

export async function fetchThreadMessages(
  threadId: string,
  actions: FetchMessagesActions,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.query("threads.get_messages", {
    thread_id: threadId,
  })
  const { messages } = parseThreadsGetMessagesResult(result)
  actions.setMessagesForThread(threadId, messages)
}

type SendMessageActions = Pick<AppActions, "appendMessage">

export async function sendThreadMessage(
  threadId: string,
  content: string,
  actions: SendMessageActions,
  client: WorkflowClient = ipcClient,
): Promise<ThreadMessageSnapshot> {
  const result = await client.command("threads.send_message", {
    thread_id: threadId,
    content,
  })
  const { message } = parseThreadsSendMessageResult(result)
  actions.appendMessage(threadId, message)
  return message
}

type SubscribeMessagesActions = Pick<AppActions, "appendMessage">

export async function subscribeToThreadMessages(
  threadId: string,
  actions: SubscribeMessagesActions,
  client: WorkflowClient = ipcClient,
): Promise<() => Promise<void>> {
  return client.subscribe(
    "threads.messages",
    { thread_id: threadId },
    (event) => {
      const parsed = parseThreadsMessagesEvent(event)
      actions.appendMessage(parsed.payload.threadId, parsed.payload)
    },
  )
}
