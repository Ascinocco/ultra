import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AppShell } from "./components/AppShell.js"
import {
  AppStoreProvider,
  type ConnectionStatus,
  createAppStore,
} from "./state/app-store.js"

function renderShell(options?: {
  currentPage?: "chat" | "editor" | "browser"
  connectionStatus?: ConnectionStatus
}) {
  return renderToStaticMarkup(
    <AppStoreProvider initialState={options}>
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
})
