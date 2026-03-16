import { describe, expect, test, vi } from "vitest"

import { makeThread, makeThreadMessage } from "../test-utils/factories.js"

import {
  fetchThreadMessages,
  fetchThreads,
  sendThreadMessage,
} from "./thread-workflows.js"

function createMockClient(responses: Record<string, unknown>) {
  return {
    query: vi.fn(async (name: string) => responses[name]),
    command: vi.fn(async (name: string) => responses[name]),
  }
}

describe("fetchThreads", () => {
  test("fetches threads and updates store", async () => {
    const threads = [makeThread("t1", "proj_1"), makeThread("t2", "proj_1")]
    const client = createMockClient({
      "threads.list_by_project": { threads },
    })
    const actions = {
      setThreadsForProject: vi.fn(),
      setThreadFetchStatus: vi.fn(),
    }

    await fetchThreads("proj_1", actions, client)

    expect(client.query).toHaveBeenCalledWith("threads.list_by_project", {
      project_id: "proj_1",
    })
    expect(actions.setThreadsForProject).toHaveBeenCalledWith("proj_1", threads)
  })
})

describe("fetchThreadMessages", () => {
  test("fetches messages and updates store", async () => {
    const messages = [makeThreadMessage("msg_1", "t1")]
    const client = createMockClient({
      "threads.get_messages": { messages },
    })
    const actions = {
      setMessagesForThread: vi.fn(),
    }

    await fetchThreadMessages("t1", actions, client)

    expect(client.query).toHaveBeenCalledWith("threads.get_messages", {
      thread_id: "t1",
    })
    expect(actions.setMessagesForThread).toHaveBeenCalledWith("t1", messages)
  })
})

describe("sendThreadMessage", () => {
  test("sends message and appends to store", async () => {
    const sentMessage = makeThreadMessage("msg_2", "t1", {
      role: "user",
      content: { text: "How is progress?" },
    })
    const client = createMockClient({
      "threads.send_message": { message: sentMessage },
    })
    const actions = {
      appendMessage: vi.fn(),
    }

    const result = await sendThreadMessage(
      "t1",
      "How is progress?",
      actions,
      client,
    )

    expect(client.command).toHaveBeenCalledWith("threads.send_message", {
      thread_id: "t1",
      content: "How is progress?",
    })
    expect(actions.appendMessage).toHaveBeenCalledWith("t1", sentMessage)
    expect(result).toEqual(sentMessage)
  })
})
