import type {
  BackendCapabilities,
  ProjectLayoutState,
  ProjectSnapshot,
} from "@ultra/shared"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { BackendStatusSnapshot } from "../../shared/backend-status.js"
import { createInitialBackendStatus } from "../../shared/backend-status.js"
import { AppShell } from "./components/AppShell.js"
import {
  AppStoreProvider,
  type ConnectionStatus,
  createAppStore,
} from "./state/app-store.js"

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
  it("defaults to the Chat page", () => {
    const markup = renderShell()

    expect(markup).toContain('data-page="chat"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain(">Chat</button>")
    expect(markup).toContain("No chats yet")
    expect(markup).toContain("Starting local backend")
  })

  it("marks only the selected pill as active", () => {
    const markup = renderShell({ currentPage: "browser" })

    expect(markup).toContain(">Browser</button>")
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it("renders every runtime status label", () => {
    const statuses: ConnectionStatus[] = [
      "connecting",
      "connected",
      "degraded",
      "disconnected",
    ]

    const labels = statuses.map((status) =>
      renderShell({ connectionStatus: status }),
    )

    expect(labels[0]).toContain("Connecting")
    expect(labels[1]).toContain("Connected")
    expect(labels[2]).toContain("Degraded")
    expect(labels[3]).toContain("Disconnected")
  })

  it("renders backend detail messaging", () => {
    const markup = renderShell({
      backendStatus: {
        connectionStatus: "degraded",
        message: "Backend exited unexpectedly. Restarting (1/2)…",
      },
    })

    expect(markup).toContain("Restarting (1/2)")
  })

  it("keeps all page shells mounted in the router", () => {
    const markup = renderShell({ currentPage: "editor" })

    expect(markup).toContain('data-page="chat"')
    expect(markup).toContain('data-page="editor"')
    expect(markup).toContain('data-page="browser"')
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
    expect(allIds).toEqual(["proj-a", "proj-b"])
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

    expect(store.getState().layout.byProjectId["proj-1"]).toEqual(layout)
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
    // First set capabilities via connected status
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
})

function makeProject(id: string, name: string): ProjectSnapshot {
  return {
    id,
    key: name.toLowerCase(),
    name,
    rootPath: `/projects/${name.toLowerCase()}`,
    gitRootPath: null,
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    lastOpenedAt: null,
  }
}
