import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AppStoreProvider, createAppStore } from "../state/app-store.js"
import { makeChat, makeProject } from "../test-utils/factories.js"
import { Sidebar } from "./Sidebar.js"

function renderSidebar(setup?: (store: ReturnType<typeof createAppStore>) => void) {
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

  it("renders project groups for all projects", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([
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
})

describe("ProjectGroup", () => {
  it("shows chats when project is expanded and chats are loaded", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setActiveProjectId("proj-1")
      store.getState().actions.toggleProjectExpanded("proj-1")
      store.getState().actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1", { title: "Design session" }),
        makeChat("c2", "proj-1", { title: "Backend review" }),
      ])
    })

    expect(markup).toContain("Design session")
    expect(markup).toContain("Backend review")
  })

  it("renders new chat button in project header", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
    })

    expect(markup).toContain("project-group__new-chat")
    expect(markup).toContain("New chat in ultra")
  })

  it("shows loading state when chats are being fetched", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.toggleProjectExpanded("proj-1")
      store.getState().actions.setChatsFetchStatus("proj-1", "loading")
    })

    expect(markup).toContain("Loading")
  })

  it("shows error state with retry when fetch fails", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.toggleProjectExpanded("proj-1")
      store.getState().actions.setChatsFetchStatus("proj-1", "error")
    })

    expect(markup).toContain("Retry")
  })

  it("shows empty state when project has no chats", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.toggleProjectExpanded("proj-1")
      store.getState().actions.setChatsForProject("proj-1", [])
    })

    expect(markup).toContain("No chats yet")
  })

  it("renders pinned chats with pin indicator", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.toggleProjectExpanded("proj-1")
      store.getState().actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1", { isPinned: true, pinnedAt: "2026-03-15T00:00:00Z", title: "Pinned chat" }),
      ])
    })

    expect(markup).toContain("Pinned chat")
    expect(markup).toContain("chat-row--pinned")
  })

  it("does not show chats when project is collapsed", () => {
    const markup = renderSidebar((store) => {
      store.getState().actions.setProjects([makeProject("proj-1", "ultra")])
      store.getState().actions.setChatsForProject("proj-1", [
        makeChat("c1", "proj-1", { title: "Hidden chat" }),
      ])
      // project not expanded
    })

    expect(markup).not.toContain("Hidden chat")
  })
})
