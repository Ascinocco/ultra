import type {
  BackendCapabilities,
  ProjectLayoutState,
  ProjectSnapshot,
} from "@ultra/shared"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BackendStatusSnapshot } from "../../shared/backend-status.js"
import { createInitialBackendStatus } from "../../shared/backend-status.js"
import { AppShell } from "./components/AppShell.js"
import {
  AppStoreProvider,
  type ConnectionStatus,
  createAppStore,
} from "./state/app-store.js"
import { makeChat, makeProject } from "./test-utils/factories.js"

function renderShell(options?: {
  currentPage?: "chat" | "editor" | "browser"
  connectionStatus?: ConnectionStatus
  backendStatus?: Partial<BackendStatusSnapshot>
}) {
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
  it("renders the chat-first workspace shell", () => {
    const markup = renderShell()

    expect(markup).toContain('data-page="chat"')
    expect(markup).toContain("Open Project")
    expect(markup).toContain("Open Terminal")
    expect(markup).toContain("System &amp; Tools")
  })

  it("renders the title bar", () => {
    const markup = renderShell()

    expect(markup).toContain("title-bar")
  })

  it("renders the sidebar, main pane, thread pane, and drawer shell", () => {
    const markup = renderShell()

    expect(markup).toContain("chat-workspace")
    expect(markup).toContain("chat-workspace__sidebar")
    expect(markup).toContain("chat-workspace__main")
    expect(markup).toContain("chat-workspace__thread-pane")
    expect(markup).toContain("terminal-drawer")
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
      rightBottomCollapsed: false,
      selectedRightPaneTab: "files",
      selectedBottomPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
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
      rightBottomCollapsed: false,
      selectedRightPaneTab: null,
      selectedBottomPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
    }

    store.getState().actions.setLayoutForProject("proj-1", fullLayout)
    store.getState().actions.setLayoutField("proj-1", { currentPage: "editor" })

    const result = store.getState().layout.byProjectId["proj-1"]
    expect(result.currentPage).toBe("chat")
    expect(result.rightTopCollapsed).toBe(false)
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

  it("tracks terminal drawer state through the layout compatibility mapping", () => {
    const store = createAppStore()

    store.getState().actions.setTerminalDrawerOpen("proj-1", true)

    expect(store.getState().terminal.drawerOpenByProjectId["proj-1"]).toBe(true)
    expect(
      store.getState().layout.byProjectId["proj-1"]?.selectedBottomPaneTab,
    ).toBe("terminal")
    expect(
      store.getState().layout.byProjectId["proj-1"]?.rightBottomCollapsed,
    ).toBe(false)
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
