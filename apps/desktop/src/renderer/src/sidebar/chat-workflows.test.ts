import type { ChatSummary } from "@ultra/shared"
import { describe, expect, it, vi } from "vitest"

import { createAppStore } from "../state/app-store.js"
import {
  archiveChat,
  createChat,
  loadChatsForProject,
  pinChat,
  renameChat,
  unpinChat,
} from "./chat-workflows.js"

function makeChat(id: string, projectId: string, opts?: Partial<ChatSummary>): ChatSummary {
  return {
    id,
    projectId,
    title: `Chat ${id}`,
    status: "active",
    provider: "claude",
    model: "claude-sonnet-4-6",
    thinkingLevel: "normal",
    permissionLevel: "supervised",
    isPinned: false,
    pinnedAt: null,
    archivedAt: null,
    lastCompactedAt: null,
    currentSessionId: null,
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    ...opts,
  }
}

describe("loadChatsForProject", () => {
  it("fetches chats and stores them in sidebar state", async () => {
    const store = createAppStore()
    const chats = [makeChat("c1", "proj-1"), makeChat("c2", "proj-1")]
    const client = {
      query: vi.fn().mockResolvedValue({ chats }),
      command: vi.fn(),
    }

    await loadChatsForProject("proj-1", store.getState().actions, client)

    expect(client.query).toHaveBeenCalledWith("chats.list", { project_id: "proj-1" })
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]).toEqual(chats)
    expect(store.getState().sidebar.chatsFetchStatus["proj-1"]).toBe("idle")
  })

  it("sets error status on failure", async () => {
    const store = createAppStore()
    const client = {
      query: vi.fn().mockRejectedValue(new Error("network error")),
      command: vi.fn(),
    }

    await loadChatsForProject("proj-1", store.getState().actions, client)

    expect(store.getState().sidebar.chatsFetchStatus["proj-1"]).toBe("error")
  })

  it("sets loading status before fetch", async () => {
    const store = createAppStore()
    let capturedStatus: string | undefined
    const client = {
      query: vi.fn().mockImplementation(() => {
        capturedStatus = store.getState().sidebar.chatsFetchStatus["proj-1"]
        return Promise.resolve({ chats: [] })
      }),
      command: vi.fn(),
    }

    await loadChatsForProject("proj-1", store.getState().actions, client)

    expect(capturedStatus).toBe("loading")
  })
})

describe("createChat", () => {
  it("creates a chat and upserts it into sidebar state", async () => {
    const store = createAppStore()
    store.getState().actions.setChatsForProject("proj-1", [])
    const newChat = makeChat("c-new", "proj-1", { title: "New Chat" })
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(newChat),
    }

    const result = await createChat("proj-1", store.getState().actions, client)

    expect(client.command).toHaveBeenCalledWith("chats.create", { project_id: "proj-1" })
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]).toContainEqual(newChat)
    expect(result).toEqual(newChat)
  })
})

describe("renameChat", () => {
  it("renames a chat and upserts the result", async () => {
    const store = createAppStore()
    const original = makeChat("c1", "proj-1", { title: "Old" })
    store.getState().actions.setChatsForProject("proj-1", [original])
    const renamed = { ...original, title: "New" }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(renamed),
    }

    await renameChat("c1", "New", store.getState().actions, client)

    expect(client.command).toHaveBeenCalledWith("chats.rename", { chat_id: "c1", title: "New" })
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]?.[0]?.title).toBe("New")
  })
})

describe("pinChat", () => {
  it("pins a chat and upserts the result", async () => {
    const store = createAppStore()
    const chat = makeChat("c1", "proj-1")
    store.getState().actions.setChatsForProject("proj-1", [chat])
    const pinned = { ...chat, isPinned: true, pinnedAt: "2026-03-15T00:00:00Z" }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(pinned),
    }

    await pinChat("c1", store.getState().actions, client)

    expect(client.command).toHaveBeenCalledWith("chats.pin", { chat_id: "c1" })
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]?.[0]?.isPinned).toBe(true)
  })
})

describe("unpinChat", () => {
  it("unpins a chat and upserts the result", async () => {
    const store = createAppStore()
    const chat = makeChat("c1", "proj-1", { isPinned: true, pinnedAt: "2026-03-15T00:00:00Z" })
    store.getState().actions.setChatsForProject("proj-1", [chat])
    const unpinned = { ...chat, isPinned: false, pinnedAt: null }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(unpinned),
    }

    await unpinChat("c1", store.getState().actions, client)

    expect(client.command).toHaveBeenCalledWith("chats.unpin", { chat_id: "c1" })
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]?.[0]?.isPinned).toBe(false)
  })
})

describe("archiveChat", () => {
  it("archives a chat and removes it from sidebar state", async () => {
    const store = createAppStore()
    store.getState().actions.setChatsForProject("proj-1", [
      makeChat("c1", "proj-1"),
      makeChat("c2", "proj-1"),
    ])
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await archiveChat("c1", "proj-1", store.getState().actions, client)

    expect(client.command).toHaveBeenCalledWith("chats.archive", { chat_id: "c1" })
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]).toHaveLength(1)
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]?.[0]?.id).toBe("c2")
  })
})
