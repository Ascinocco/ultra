import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AppStoreProvider, createAppStore } from "../state/app-store.js"
import { makeChat, makeProject } from "../test-utils/factories.js"
import { Sidebar } from "./Sidebar.js"

function renderSidebar(
  setup?: (store: ReturnType<typeof createAppStore>) => void,
) {
  const store = createAppStore()
  setup?.(store)
  // Zustand's useSyncExternalStore uses getInitialState() during SSR,
  // so we need to sync it with the current (mutated) state for tests.
  const currentState = store.getState()
  store.getInitialState = () => currentState
  return renderToStaticMarkup(
    <AppStoreProvider store={store}>
      <Sidebar onOpenProject={() => undefined} />
    </AppStoreProvider>,
  )
}

describe("Sidebar", () => {
  it("renders the sidebar container", () => {
    const markup = renderSidebar()

    expect(markup).toContain("sidebar")
  })

  it("renders all projects in the navigation list", () => {
    const markup = renderSidebar((store) => {
      store
        .getState()
        .actions.setProjects([
          makeProject("proj-1", "ultra"),
          makeProject("proj-2", "mulch"),
        ])
    })

    expect(markup).toContain("ultra")
    expect(markup).toContain("mulch")
  })

  it("renders the Projects section label", () => {
    const markup = renderSidebar()

    expect(markup).toContain("Projects")
  })

  it("renders Settings and Open Project in the footer", () => {
    const markup = renderSidebar()

    expect(markup).toContain("Settings")
    expect(markup).toContain("Open Project")
  })

  it("shows chats only for the active project", () => {
    const markup = renderSidebar((store) => {
      store
        .getState()
        .actions.setProjects([
          makeProject("proj-1", "ultra"),
          makeProject("proj-2", "mulch"),
        ])
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1", {
          title: "Design session",
          updatedAt: "2026-03-15T00:00:00Z",
        }),
        makeChat("c2", "proj-1", {
          title: "Backend review",
          updatedAt: "2026-03-14T00:00:00Z",
        }),
      ])
      store
        .getState()
        .actions.setChatsForProject("proj-2", [
          makeChat("c3", "proj-2", { title: "Hidden chat" }),
        ])
    })

    expect(markup).toContain("Design session")
    expect(markup).toContain("Backend review")
    expect(markup).not.toContain("Hidden chat")
  })

  it("renders new chat button for the active project", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setActiveProjectId("proj-1")
    })

    expect(markup).toContain("sidebar__new-chat")
    expect(markup).toContain("New Chat")
  })

  it("shows loading state when chats are being fetched", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setChatsFetchStatus("proj-1", "loading")
    })

    expect(markup).toContain("Loading")
  })

  it("shows error state when fetch fails", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setChatsFetchStatus("proj-1", "error")
    })

    expect(markup).toContain("Failed to load chats")
  })

  it("shows empty state when project has no chats", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setChatsForProject("proj-1", [])
    })

    expect(markup).toContain("No chats yet")
  })

  it("renders pinned chats with pin indicator", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1", {
          isPinned: true,
          pinnedAt: "2026-03-15T00:00:00Z",
          title: "Pinned chat",
        }),
      ])
    })

    expect(markup).toContain("Pinned chat")
    expect(markup).toContain("chat-row--pinned")
  })

  it("orders pinned chats before unpinned chats", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1", {
          title: "Later chat",
          updatedAt: "2026-03-15T00:00:00Z",
        }),
        makeChat("c2", "proj-1", {
          title: "Pinned chat",
          isPinned: true,
          pinnedAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-14T00:00:00Z",
        }),
      ])
      store.getState().actions.setActiveProjectId("proj-1")
    })

    expect(markup.indexOf("Pinned chat")).toBeLessThan(
      markup.indexOf("Later chat"),
    )
  })
})
