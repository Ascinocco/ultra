import type {
  BackendCapabilities,
  ProjectLayoutState,
  ProjectSnapshot,
} from "@ultra/shared"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BackendStatusSnapshot } from "../../shared/backend-status.js"
import { createInitialBackendStatus } from "../../shared/backend-status.js"
import {
  AppStoreProvider,
  type ConnectionStatus,
  createAppStore,
} from "./state/app-store.js"
import {
  makeChat,
  makeChatMessage,
  makeProject,
} from "./test-utils/factories.js"

vi.mock("./terminal/TerminalPane.js", () => ({
  TerminalPane: () => null,
}))

async function renderShell(options?: {
  currentPage?: "chat" | "editor" | "browser"
  connectionStatus?: ConnectionStatus
  backendStatus?: Partial<BackendStatusSnapshot>
}) {
  if (typeof globalThis.self === "undefined") {
    Object.defineProperty(globalThis, "self", {
      value: globalThis,
      configurable: true,
      writable: true,
    })
  }

  const { AppShell } = await import("./components/AppShell.js")

  const initialBackendStatus = {
    ...createInitialBackendStatus(),
    ...options?.backendStatus,
  }

  return renderToStaticMarkup(
    <AppStoreProvider
      initialState={{
        ...options,
        backendStatus: initialBackendStatus,
        connectionStatus:
          options?.connectionStatus ?? initialBackendStatus.connectionStatus,
      }}
    >
      <AppShell />
    </AppStoreProvider>,
  )
}

describe("AppShell", () => {
  it("renders the chat-first workspace shell", async () => {
    const markup = await renderShell()

    expect(markup).toContain('data-page="chat"')
    expect(markup).toContain("Open Project")
  })

  it("renders the title bar with terminal toggle and sandbox selector", async () => {
    const markup = await renderShell()

    expect(markup).toContain("title-bar")
    expect(markup).toContain("title-bar__terminal-toggle")
    expect(markup).toContain("sandbox-selector")
  })

  it("renders the connected-panel chat frame with sidebar, main, and side panes", async () => {
    const markup = await renderShell()

    expect(markup).toContain("chat-frame")
    expect(markup).toContain("chat-frame__rail")
    expect(markup).toContain("chat-frame__main")
    expect(markup).toContain("active-chat-pane")
    expect(markup).toContain("chat-frame__side")
  })
})

describe("app store", () => {
  it("switches pages through the action API", () => {
    const store = createAppStore()

    store.getState().actions.setCurrentPage("editor")

    expect(store.getState().app.currentPage).toBe("editor")
  })

  it("syncs backend snapshots through the action API", () => {
    const store = createAppStore()

    store.getState().actions.setBackendStatus({
      ...createInitialBackendStatus(),
      phase: "running",
      connectionStatus: "connected",
      message: "Local backend running.",
      pid: 42,
      socketPath: "/tmp/ultra.sock",
      updatedAt: "2026-03-14T00:00:00Z",
    })

    expect(store.getState().app.connectionStatus).toBe("connected")
    expect(store.getState().app.backendStatus.pid).toBe(42)
  })

  it("setProjects normalizes an array into byId/allIds", () => {
    const store = createAppStore()
    const projects: ProjectSnapshot[] = [
      makeProject("proj-b", "Beta"),
      makeProject("proj-a", "Alpha"),
    ]

    store.getState().actions.setProjects(projects)

    const { byId, allIds } = store.getState().projects
    expect(allIds).toEqual(["proj-b", "proj-a"])
    expect(byId["proj-a"].name).toBe("Alpha")
    expect(byId["proj-b"].name).toBe("Beta")
  })

  it("upsertProject adds a new project", () => {
    const store = createAppStore()

    store.getState().actions.upsertProject(makeProject("proj-1", "First"))

    expect(store.getState().projects.allIds).toEqual(["proj-1"])
    expect(store.getState().projects.byId["proj-1"].name).toBe("First")
  })

  it("upsertProject updates an existing project", () => {
    const store = createAppStore()
    store.getState().actions.setProjects([makeProject("proj-1", "Old Name")])

    store.getState().actions.upsertProject(makeProject("proj-1", "New Name"))

    expect(store.getState().projects.allIds).toEqual(["proj-1"])
    expect(store.getState().projects.byId["proj-1"].name).toBe("New Name")
  })

  it("setLayoutForProject stores layout per project ID", () => {
    const store = createAppStore()
    const layout: ProjectLayoutState = {
      currentPage: "editor",
      rightTopCollapsed: true,
      selectedRightPaneTab: "files",
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
      sidebarCollapsed: false,
      chatThreadSplitRatio: 0.55,
    }

    store.getState().actions.setLayoutForProject("proj-1", layout)

    expect(store.getState().layout.byProjectId["proj-1"]).toEqual({
      ...layout,
      currentPage: "chat",
    })
  })

  it("setCapabilities stores capabilities on the app slice", () => {
    const store = createAppStore()
    const caps: BackendCapabilities = {
      supportsProjects: true,
      supportsLayoutPersistence: true,
      supportsSubscriptions: false,
      supportsBackendInfo: true,
    }

    store.getState().actions.setCapabilities(caps)

    expect(store.getState().app.capabilities).toEqual(caps)
  })

  it("setBackendStatus hydrates capabilities when connected", () => {
    const store = createAppStore()
    const caps: BackendCapabilities = {
      supportsProjects: true,
      supportsLayoutPersistence: false,
      supportsSubscriptions: false,
      supportsBackendInfo: true,
    }

    store.getState().actions.setBackendStatus({
      ...createInitialBackendStatus(),
      phase: "running",
      connectionStatus: "connected",
      capabilities: caps,
      updatedAt: "2026-03-14T00:00:00Z",
    })

    expect(store.getState().app.capabilities).toEqual(caps)
  })

  it("setBackendStatus clears capabilities when disconnected", () => {
    const store = createAppStore()
    store.getState().actions.setCapabilities({
      supportsProjects: true,
      supportsLayoutPersistence: true,
      supportsSubscriptions: true,
      supportsBackendInfo: true,
    })

    store.getState().actions.setBackendStatus({
      ...createInitialBackendStatus(),
      phase: "degraded",
      connectionStatus: "degraded",
      updatedAt: "2026-03-14T00:00:00Z",
    })

    expect(store.getState().app.capabilities).toBeNull()
  })

  it("sets the active project through the action API", () => {
    const store = createAppStore()

    store.getState().actions.setActiveProjectId("proj-1")

    expect(store.getState().app.activeProjectId).toBe("proj-1")
  })

  it("tracks project-open status and error messaging", () => {
    const store = createAppStore()

    store.getState().actions.setProjectOpenState("error", "Project open failed")

    expect(store.getState().app.projectOpenStatus).toBe("error")
    expect(store.getState().app.projectOpenError).toBe("Project open failed")
  })

  it("setLayoutField merges partial into existing layout", () => {
    const store = createAppStore()
    const fullLayout: ProjectLayoutState = {
      currentPage: "chat",
      rightTopCollapsed: false,
      selectedRightPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
      sidebarCollapsed: false,
      chatThreadSplitRatio: 0.55,
    }

    store.getState().actions.setLayoutForProject("proj-1", fullLayout)
    store.getState().actions.setLayoutField("proj-1", { currentPage: "editor" })

    const result = store.getState().layout.byProjectId["proj-1"]
    expect(result.currentPage).toBe("chat")
    expect(result.rightTopCollapsed).toBe(false)
  })

  it("DEFAULT_LAYOUT: sidebarCollapsed defaults to false", () => {
    const store = createAppStore()

    store.getState().actions.setLayoutField("proj-new", {})

    const result = store.getState().layout.byProjectId["proj-new"]
    expect(result.sidebarCollapsed).toBe(false)
  })

  it("DEFAULT_LAYOUT: chatThreadSplitRatio defaults to 0.55", () => {
    const store = createAppStore()

    store.getState().actions.setLayoutField("proj-new", {})

    const result = store.getState().layout.byProjectId["proj-new"]
    expect(result.chatThreadSplitRatio).toBe(0.55)
  })

  it("setLayoutField creates default layout if project has no entry", () => {
    const store = createAppStore()

    store
      .getState()
      .actions.setLayoutField("proj-new", { rightTopCollapsed: true })

    const result = store.getState().layout.byProjectId["proj-new"]
    expect(result.currentPage).toBe("chat")
    expect(result.rightTopCollapsed).toBe(true)
  })

  describe("setLayoutField debounced persist", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("coalesces rapid updates into a single IPC call after 300ms", async () => {
      const { ipcClient } = await import("./ipc/ipc-client.js")
      const commandSpy = vi
        .spyOn(ipcClient, "command")
        .mockResolvedValue(undefined)

      const store = createAppStore()

      store
        .getState()
        .actions.setLayoutField("proj-1", { currentPage: "editor" })
      store
        .getState()
        .actions.setLayoutField("proj-1", { rightTopCollapsed: true })

      expect(commandSpy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(300)

      expect(commandSpy).toHaveBeenCalledTimes(1)
      expect(commandSpy).toHaveBeenCalledWith("projects.set_layout", {
        project_id: "proj-1",
        layout: store.getState().layout.byProjectId["proj-1"],
      })

      commandSpy.mockRestore()
    })

    it("per-project debounce: changes to one project do not cancel another", async () => {
      const { ipcClient } = await import("./ipc/ipc-client.js")
      const commandSpy = vi
        .spyOn(ipcClient, "command")
        .mockResolvedValue(undefined)

      const store = createAppStore()

      store
        .getState()
        .actions.setLayoutField("proj-a", { currentPage: "editor" })
      store
        .getState()
        .actions.setLayoutField("proj-b", { currentPage: "browser" })

      vi.advanceTimersByTime(300)

      expect(commandSpy).toHaveBeenCalledTimes(2)

      commandSpy.mockRestore()
    })
  })
})

describe("sidebar slice", () => {
  it("starts with empty sidebar state", () => {
    const store = createAppStore()
    const { sidebar } = store.getState()

    expect(sidebar.expandedProjectIds).toEqual([])
    expect(sidebar.chatsByProjectId).toEqual({})
    expect(sidebar.chatsFetchStatus).toEqual({})
  })

  it("toggleProjectExpanded adds and removes project IDs", () => {
    const store = createAppStore()

    store.getState().actions.toggleProjectExpanded("proj-1")
    expect(store.getState().sidebar.expandedProjectIds).toEqual(["proj-1"])

    store.getState().actions.toggleProjectExpanded("proj-2")
    expect(store.getState().sidebar.expandedProjectIds).toEqual([
      "proj-1",
      "proj-2",
    ])

    store.getState().actions.toggleProjectExpanded("proj-1")
    expect(store.getState().sidebar.expandedProjectIds).toEqual(["proj-2"])
  })

  it("setChatsForProject stores chat list for a project", () => {
    const store = createAppStore()
    const chats = [makeChat("c1", "proj-1"), makeChat("c2", "proj-1")]

    store.getState().actions.setChatsForProject("proj-1", chats)

    expect(store.getState().sidebar.chatsByProjectId["proj-1"]).toEqual(chats)
  })

  it("setChatsFetchStatus tracks loading state per project", () => {
    const store = createAppStore()

    store.getState().actions.setChatsFetchStatus("proj-1", "loading")
    expect(store.getState().sidebar.chatsFetchStatus["proj-1"]).toBe("loading")

    store.getState().actions.setChatsFetchStatus("proj-1", "idle")
    expect(store.getState().sidebar.chatsFetchStatus["proj-1"]).toBe("idle")
  })

  it("upsertChat adds a new chat to the correct project", () => {
    const store = createAppStore()
    store.getState().actions.setChatsForProject("proj-1", [])

    store.getState().actions.upsertChat(makeChat("c1", "proj-1"))

    expect(store.getState().sidebar.chatsByProjectId["proj-1"]).toHaveLength(1)
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]?.[0]?.id).toBe(
      "c1",
    )
  })

  it("upsertChat updates an existing chat in place", () => {
    const store = createAppStore()
    store
      .getState()
      .actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1", { title: "Old Title" }),
      ])

    store
      .getState()
      .actions.upsertChat(makeChat("c1", "proj-1", { title: "New Title" }))

    expect(store.getState().sidebar.chatsByProjectId["proj-1"]).toHaveLength(1)
    expect(
      store.getState().sidebar.chatsByProjectId["proj-1"]?.[0]?.title,
    ).toBe("New Title")
  })

  it("removeChat removes a chat from the project list", () => {
    const store = createAppStore()
    store
      .getState()
      .actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1"),
        makeChat("c2", "proj-1"),
      ])

    store.getState().actions.removeChat("c1", "proj-1")

    expect(store.getState().sidebar.chatsByProjectId["proj-1"]).toHaveLength(1)
    expect(store.getState().sidebar.chatsByProjectId["proj-1"]?.[0]?.id).toBe(
      "c2",
    )
  })
})

describe("chat message slice", () => {
  it("setMessagesForChat stores transcript history and marks fetch idle", () => {
    const store = createAppStore()
    const messages = [
      makeChatMessage("chat_msg_1", "chat_1", { role: "user" }),
      makeChatMessage("chat_msg_2", "chat_1", { role: "assistant" }),
    ]

    store.getState().actions.setMessagesForChat("chat_1", messages)

    expect(store.getState().chatMessages.messagesByChatId.chat_1).toEqual(
      messages,
    )
    expect(store.getState().chatMessages.fetchStatusByChatId.chat_1).toBe(
      "idle",
    )
  })

  it("upsertChatMessage de-duplicates by message id", () => {
    const store = createAppStore()
    const message = makeChatMessage("chat_msg_1", "chat_1")

    store.getState().actions.upsertChatMessage("chat_1", message)
    store.getState().actions.upsertChatMessage("chat_1", message)

    expect(store.getState().chatMessages.messagesByChatId.chat_1).toHaveLength(
      1,
    )
  })
})

describe("chat turn slice", () => {
  it("setTurnsForChat stores turn snapshots and selects in-flight turn", () => {
    const store = createAppStore()
    const turns = [
      {
        turnId: "chat_turn_done",
        chatId: "chat_1",
        sessionId: "chat_sess_1",
        clientTurnId: null,
        userMessageId: "chat_msg_user_1",
        assistantMessageId: "chat_msg_assistant_1",
        status: "succeeded" as const,
        provider: "claude" as const,
        model: "claude-sonnet-4-6",
        vendorSessionId: null,
        startedAt: "2026-03-19T12:00:00.000Z",
        updatedAt: "2026-03-19T12:00:10.000Z",
        completedAt: "2026-03-19T12:00:10.000Z",
        failureCode: null,
        failureMessage: null,
        cancelRequestedAt: null,
      },
      {
        turnId: "chat_turn_running",
        chatId: "chat_1",
        sessionId: "chat_sess_1",
        clientTurnId: null,
        userMessageId: "chat_msg_user_2",
        assistantMessageId: null,
        status: "running" as const,
        provider: "claude" as const,
        model: "claude-sonnet-4-6",
        vendorSessionId: null,
        startedAt: "2026-03-19T12:00:20.000Z",
        updatedAt: "2026-03-19T12:00:22.000Z",
        completedAt: null,
        failureCode: null,
        failureMessage: null,
        cancelRequestedAt: null,
      },
    ]

    store.getState().actions.setTurnsForChat("chat_1", turns)

    expect(store.getState().chatTurns.turnsByChatId.chat_1).toEqual(turns)
    expect(store.getState().chatTurns.activeTurnIdByChatId.chat_1).toBe(
      "chat_turn_running",
    )
    expect(store.getState().chatTurns.fetchStatusByChatId.chat_1).toBe("idle")
  })

  it("appendChatTurnEvent de-duplicates and keeps event order by sequence", () => {
    const store = createAppStore()
    const event2 = {
      eventId: "chat_turn_event_2",
      chatId: "chat_1",
      turnId: "chat_turn_1",
      sequenceNumber: 2,
      eventType: "chat.turn_progress",
      source: "runtime",
      actorType: "system",
      actorId: null,
      payload: { stage: "running" },
      occurredAt: "2026-03-19T12:00:02.000Z",
      recordedAt: "2026-03-19T12:00:02.000Z",
    }
    const event1 = {
      ...event2,
      eventId: "chat_turn_event_1",
      sequenceNumber: 1,
      occurredAt: "2026-03-19T12:00:01.000Z",
      recordedAt: "2026-03-19T12:00:01.000Z",
    }

    store.getState().actions.appendChatTurnEvent(event2)
    store.getState().actions.appendChatTurnEvent(event1)
    store.getState().actions.appendChatTurnEvent(event2)

    expect(store.getState().chatTurns.eventsByTurnId.chat_turn_1).toEqual([
      event1,
      event2,
    ])
  })

  it("setChatTurnSendState tracks errors and clears error when state returns idle", () => {
    const store = createAppStore()

    store.getState().actions.setChatTurnSendState("chat_1", "error", "conflict")
    expect(store.getState().chatTurns.sendStatusByChatId.chat_1).toBe("error")
    expect(store.getState().chatTurns.sendErrorByChatId.chat_1).toBe("conflict")

    store.getState().actions.setChatTurnSendState("chat_1", "idle")
    expect(store.getState().chatTurns.sendStatusByChatId.chat_1).toBe("idle")
    expect(store.getState().chatTurns.sendErrorByChatId.chat_1).toBeNull()
  })
})

describe("sandbox and terminal slices", () => {
  it("stores project sandboxes and active sandbox IDs", () => {
    const store = createAppStore()

    store.getState().actions.setSandboxesForProject("proj-1", [
      {
        sandboxId: "sandbox-1",
        projectId: "proj-1",
        threadId: null,
        path: "/projects/alpha",
        displayName: "Main",
        sandboxType: "main_checkout",
        branchName: "main",
        baseBranch: "main",
        isMainCheckout: true,
        createdAt: "2026-03-14T00:00:00Z",
        updatedAt: "2026-03-14T00:00:00Z",
        lastUsedAt: "2026-03-14T00:00:00Z",
      },
    ])
    store.getState().actions.setActiveSandboxIdForProject("proj-1", "sandbox-1")

    expect(store.getState().sandboxes.idsByProjectId["proj-1"]).toEqual([
      "sandbox-1",
    ])
    expect(store.getState().sandboxes.activeByProjectId["proj-1"]).toBe(
      "sandbox-1",
    )
  })

  it("tracks terminal drawer state through drawerOpenByProjectId", () => {
    const store = createAppStore()

    store.getState().actions.setTerminalDrawerOpen("proj-1", true)

    expect(store.getState().terminal.drawerOpenByProjectId["proj-1"]).toBe(true)

    store.getState().actions.setTerminalDrawerOpen("proj-1", false)

    expect(store.getState().terminal.drawerOpenByProjectId["proj-1"]).toBe(
      false,
    )
  })

  it("keeps the focused terminal session in sync with session updates", () => {
    const store = createAppStore()

    store.getState().actions.setTerminalSessionsForProject("proj-1", [
      {
        sessionId: "term-1",
        projectId: "proj-1",
        sandboxId: "sandbox-1",
        threadId: null,
        cwd: "/projects/alpha",
        title: "Shell · Main",
        sessionKind: "shell",
        status: "running",
        commandId: null,
        commandLabel: null,
        commandLine: "zsh",
        exitCode: null,
        startedAt: "2026-03-14T00:00:00Z",
        updatedAt: "2026-03-14T00:00:00Z",
        lastOutputAt: null,
        lastOutputSequence: 0,
        recentOutput: "",
      },
    ])

    expect(
      store.getState().terminal.focusedSessionIdByProjectId["proj-1"],
    ).toBe("term-1")
  })
})
