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
})
