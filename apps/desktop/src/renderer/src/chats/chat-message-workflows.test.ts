import { describe, expect, it, vi } from "vitest"

import { makeChatMessage, makeThread } from "../test-utils/factories.js"
import {
  approvePlan,
  approveSpecs,
  fetchChatMessages,
  fetchChatTurn,
  fetchChatTurns,
  replayChatTurnEvents,
  selectCurrentTurn,
  startChatTurn,
  startThreadFromChat,
  subscribeToChatMessages,
  subscribeToChatTurnEvents,
} from "./chat-message-workflows.js"

function createMockClient(responses: Record<string, unknown>) {
  return {
    query: vi.fn(async (name: string) => responses[name]),
    command: vi.fn(async (name: string) => responses[name]),
    subscribe: vi.fn(),
  }
}

function makeTurn(
  turnId: string,
  chatId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    turnId,
    chatId,
    sessionId: "chat_sess_1",
    clientTurnId: null,
    userMessageId: "chat_msg_user_1",
    assistantMessageId: null,
    status: "queued",
    provider: "claude",
    model: "claude-sonnet-4-6",
    vendorSessionId: null,
    startedAt: "2026-03-19T12:00:00.000Z",
    updatedAt: "2026-03-19T12:00:00.000Z",
    completedAt: null,
    failureCode: null,
    failureMessage: null,
    cancelRequestedAt: null,
    ...overrides,
  }
}

function makeTurnEvent(
  eventId: string,
  chatId: string,
  turnId: string,
  sequenceNumber: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    eventId,
    chatId,
    turnId,
    sequenceNumber,
    eventType: "chat.turn_progress",
    source: "runtime",
    actorType: "system",
    actorId: null,
    payload: { stage: "running" },
    occurredAt: "2026-03-19T12:00:01.000Z",
    recordedAt: "2026-03-19T12:00:01.000Z",
    ...overrides,
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

describe("startChatTurn", () => {
  it("starts a turn via chats.start_turn and updates turn send state", async () => {
    const turn = makeTurn("chat_turn_1", "chat_1")
    const client = createMockClient({
      "chats.start_turn": {
        accepted: true,
        turn,
      },
    })
    const actions = {
      setChatTurnSendState: vi.fn(),
      upsertChatTurn: vi.fn(),
      setActiveChatTurn: vi.fn(),
    }

    const result = await startChatTurn(
      "chat_1",
      "Plan the migration.",
      actions,
      client,
    )

    expect(actions.setChatTurnSendState).toHaveBeenNthCalledWith(
      1,
      "chat_1",
      "starting",
    )
    expect(client.command).toHaveBeenCalledWith("chats.start_turn", {
      chat_id: "chat_1",
      prompt: "Plan the migration.",
      client_turn_id: expect.any(String),
    })
    expect(actions.upsertChatTurn).toHaveBeenCalledWith("chat_1", turn)
    expect(actions.setActiveChatTurn).toHaveBeenCalledWith(
      "chat_1",
      "chat_turn_1",
    )
    expect(actions.setChatTurnSendState).toHaveBeenNthCalledWith(
      2,
      "chat_1",
      "idle",
    )
    expect(result.turn.turnId).toBe("chat_turn_1")
  })

  it("persists runtime config before starting when provided", async () => {
    const turn = makeTurn("chat_turn_2", "chat_1", {
      provider: "claude",
      model: "claude-sonnet-4-6",
    })
    const client = createMockClient({
      "chats.update_runtime_config": {
        id: "chat_1",
        projectId: "proj_1",
        title: "Chat 1",
        status: "active",
        provider: "claude",
        model: "claude-sonnet-4-6",
        thinkingLevel: "high",
        permissionLevel: "full_access",
        isPinned: false,
        pinnedAt: null,
        archivedAt: null,
        lastCompactedAt: null,
        currentSessionId: "chat_sess_1",
        createdAt: "2026-03-19T12:00:00.000Z",
        updatedAt: "2026-03-19T12:00:00.000Z",
      },
      "chats.start_turn": {
        accepted: true,
        turn,
      },
    })
    const actions = {
      setChatTurnSendState: vi.fn(),
      upsertChatTurn: vi.fn(),
      setActiveChatTurn: vi.fn(),
    }

    await startChatTurn("chat_1", "Use Claude for this turn.", actions, client, {
      provider: "claude",
      model: "claude-sonnet-4-6",
      thinkingLevel: "high",
      permissionLevel: "full_access",
    })

    expect(client.command).toHaveBeenNthCalledWith(1, "chats.update_runtime_config", {
      chat_id: "chat_1",
      provider: "claude",
      model: "claude-sonnet-4-6",
      thinking_level: "high",
      permission_level: "full_access",
    })
    expect(client.command).toHaveBeenNthCalledWith(2, "chats.start_turn", {
      chat_id: "chat_1",
      prompt: "Use Claude for this turn.",
      client_turn_id: expect.any(String),
    })
  })

  it("surfaces runtime-config update failures and skips start_turn", async () => {
    const client = {
      query: vi.fn(),
      command: vi.fn(async (name: string) => {
        if (name === "chats.update_runtime_config") {
          throw new Error("invalid runtime config")
        }
        return {
          accepted: true,
          turn: makeTurn("chat_turn_3", "chat_1"),
        }
      }),
      subscribe: vi.fn(),
    }
    const actions = {
      setChatTurnSendState: vi.fn(),
      upsertChatTurn: vi.fn(),
      setActiveChatTurn: vi.fn(),
    }

    await expect(
      startChatTurn("chat_1", "Prompt", actions, client, {
        provider: "claude",
        model: "claude-sonnet-4-6",
        thinkingLevel: "high",
        permissionLevel: "full_access",
      }),
    ).rejects.toThrow("invalid runtime config")

    expect(client.command).toHaveBeenCalledTimes(1)
    expect(client.command).toHaveBeenCalledWith("chats.update_runtime_config", {
      chat_id: "chat_1",
      provider: "claude",
      model: "claude-sonnet-4-6",
      thinking_level: "high",
      permission_level: "full_access",
    })
    expect(actions.setChatTurnSendState).toHaveBeenNthCalledWith(
      1,
      "chat_1",
      "starting",
    )
    expect(actions.setChatTurnSendState).toHaveBeenNthCalledWith(
      2,
      "chat_1",
      "error",
      "invalid runtime config",
    )
  })
})

describe("fetchChatTurns", () => {
  it("loads turn snapshots for a chat and updates fetch status", async () => {
    const turn = makeTurn("chat_turn_1", "chat_1")
    const client = createMockClient({
      "chats.list_turns": {
        turns: [turn],
        nextCursor: null,
      },
    })
    const actions = {
      setTurnsForChat: vi.fn(),
      setChatTurnsFetchStatus: vi.fn(),
    }

    const result = await fetchChatTurns("chat_1", actions, client)

    expect(actions.setChatTurnsFetchStatus).toHaveBeenNthCalledWith(
      1,
      "chat_1",
      "loading",
    )
    expect(client.query).toHaveBeenCalledWith("chats.list_turns", {
      chat_id: "chat_1",
    })
    expect(actions.setTurnsForChat).toHaveBeenCalledWith("chat_1", [turn])
    expect(result.turns).toHaveLength(1)
  })
})

describe("fetchChatTurn", () => {
  it("queries and upserts a single chat turn snapshot", async () => {
    const turn = makeTurn("chat_turn_7", "chat_1", { status: "running" })
    const client = createMockClient({
      "chats.get_turn": turn,
    })
    const actions = {
      upsertChatTurn: vi.fn(),
    }

    const result = await fetchChatTurn("chat_1", "chat_turn_7", actions, client)

    expect(client.query).toHaveBeenCalledWith("chats.get_turn", {
      chat_id: "chat_1",
      turn_id: "chat_turn_7",
    })
    expect(actions.upsertChatTurn).toHaveBeenCalledWith("chat_1", turn)
    expect(result.turnId).toBe("chat_turn_7")
  })
})

describe("replayChatTurnEvents", () => {
  it("replays turn events using from_sequence and appends each event", async () => {
    const events = [
      makeTurnEvent("chat_turn_event_2", "chat_1", "chat_turn_1", 2),
      makeTurnEvent("chat_turn_event_3", "chat_1", "chat_turn_1", 3, {
        eventType: "chat.turn_completed",
      }),
    ]
    const client = createMockClient({
      "chats.get_turn_events": {
        events,
      },
    })
    const actions = {
      appendChatTurnEvent: vi.fn(),
    }

    const result = await replayChatTurnEvents(
      "chat_1",
      "chat_turn_1",
      actions,
      1,
      client,
    )

    expect(client.query).toHaveBeenCalledWith("chats.get_turn_events", {
      chat_id: "chat_1",
      turn_id: "chat_turn_1",
      from_sequence: 1,
    })
    expect(actions.appendChatTurnEvent).toHaveBeenCalledTimes(2)
    expect(actions.appendChatTurnEvent).toHaveBeenCalledWith(events[0])
    expect(actions.appendChatTurnEvent).toHaveBeenCalledWith(events[1])
    expect(result.events).toHaveLength(2)
  })
})

describe("selectCurrentTurn", () => {
  it("prefers queued or running turns over terminal turns", () => {
    const turns = [
      makeTurn("chat_turn_done", "chat_1", { status: "succeeded" }),
      makeTurn("chat_turn_running", "chat_1", { status: "running" }),
    ]

    const selected = selectCurrentTurn(turns)
    expect(selected?.turnId).toBe("chat_turn_running")
  })
})

describe("approvePlan", () => {
  it("sends chats.approve_plan and upserts the returned approval message", async () => {
    const approvalMessage = makeChatMessage(
      "chat_msg_plan_approval",
      "chat_1",
      {
        role: "user",
        messageType: "plan_approval",
        contentMarkdown: "Plan approved.",
      },
    )
    const client = createMockClient({
      "chats.approve_plan": approvalMessage,
    })
    const actions = {
      upsertChatMessage: vi.fn(),
    }

    const result = await approvePlan("chat_1", actions, client)

    expect(client.command).toHaveBeenCalledWith("chats.approve_plan", {
      chat_id: "chat_1",
    })
    expect(actions.upsertChatMessage).toHaveBeenCalledWith(
      "chat_1",
      approvalMessage,
    )
    expect(result.messageType).toBe("plan_approval")
  })
})

describe("approveSpecs", () => {
  it("sends chats.approve_specs and upserts the returned approval message", async () => {
    const approvalMessage = makeChatMessage(
      "chat_msg_spec_approval",
      "chat_1",
      {
        role: "user",
        messageType: "spec_approval",
        contentMarkdown: "Specs approved.",
      },
    )
    const client = createMockClient({
      "chats.approve_specs": approvalMessage,
    })
    const actions = {
      upsertChatMessage: vi.fn(),
    }

    const result = await approveSpecs("chat_1", actions, client)

    expect(client.command).toHaveBeenCalledWith("chats.approve_specs", {
      chat_id: "chat_1",
    })
    expect(actions.upsertChatMessage).toHaveBeenCalledWith(
      "chat_1",
      approvalMessage,
    )
    expect(result.messageType).toBe("spec_approval")
  })
})

describe("startThreadFromChat", () => {
  it("creates a thread using explicit confirmation when no start request id is provided", async () => {
    const thread = makeThread("thread_1", "proj_1", {
      sourceChatId: "chat_1",
      title: "Chat 1",
      createdByMessageId: "chat_msg_start_request",
    })
    const client = createMockClient({
      "chats.start_thread": {
        thread,
        specRefs: [],
        ticketRefs: [],
      },
    })

    const result = await startThreadFromChat(
      {
        chatId: "chat_1",
        title: "Chat 1",
        summary: "Start this workstream",
        planApprovalMessageId: "chat_msg_plan",
        specApprovalMessageId: "chat_msg_spec",
      },
      client,
    )

    expect(client.command).toHaveBeenCalledWith("chats.start_thread", {
      chat_id: "chat_1",
      title: "Chat 1",
      summary: "Start this workstream",
      plan_approval_message_id: "chat_msg_plan",
      spec_approval_message_id: "chat_msg_spec",
      confirm_start: true,
      spec_refs: [],
      ticket_refs: [],
    })
    expect(result.thread.id).toBe("thread_1")
  })
})

describe("subscribeToChatMessages", () => {
  it("subscribes to chats.messages and routes parsed events into store updates", async () => {
    let capturedListener: ((event: unknown) => void) | null = null
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn().mockImplementation((_name, _payload, listener) => {
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

describe("subscribeToChatTurnEvents", () => {
  it("subscribes to chats.turn_events and forwards parsed payload", async () => {
    let capturedListener: ((event: unknown) => void) | null = null
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const client = {
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn().mockImplementation((_name, _payload, listener) => {
        capturedListener = listener
        return Promise.resolve(unsubscribe)
      }),
    }
    const actions = {
      appendChatTurnEvent: vi.fn(),
    }
    const onEvent = vi.fn()

    const result = await subscribeToChatTurnEvents(
      { chatId: "chat_1" },
      actions,
      onEvent,
      client,
    )

    expect(client.subscribe).toHaveBeenCalledWith(
      "chats.turn_events",
      { chat_id: "chat_1" },
      expect.any(Function),
    )

    const turnEvent = makeTurnEvent(
      "chat_turn_event_1",
      "chat_1",
      "chat_turn_1",
      1,
    )
    capturedListener?.({
      protocol_version: "1.0",
      type: "event",
      subscription_id: "sub_chat_turn_1",
      event_name: "chats.turn_events",
      payload: turnEvent,
    })

    expect(actions.appendChatTurnEvent).toHaveBeenCalledWith(turnEvent)
    expect(onEvent).toHaveBeenCalledWith(turnEvent)
    expect(result).toBe(unsubscribe)
  })
})
