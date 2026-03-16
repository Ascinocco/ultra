import { useEffect, useRef } from "react"

import { BrowserPageShell } from "../pages/BrowserPageShell.js"
import { ChatPageShell } from "../pages/ChatPageShell.js"
import { EditorPageShell } from "../pages/EditorPageShell.js"
import {
  hydrateLastProject,
  openProjectFromPath,
  openProjectFromPicker,
} from "../projects/project-workflows.js"
import { useAppStore } from "../state/app-store.js"
import { TitleBar } from "./TitleBar.js"

export function AppShell() {
  const app = useAppStore((state) => state.app)
  const actions = useAppStore((state) => state.actions)
  const loadedProjectsSessionRef = useRef<string | null>(null)

  const canOpenProjects =
    app.connectionStatus === "connected" &&
    Boolean(app.capabilities?.supportsProjects)

  useEffect(() => {
    if (!canOpenProjects) {
      loadedProjectsSessionRef.current = null
      return
    }

    const sessionId = app.backendStatus.sessionId ?? "connected"
    if (loadedProjectsSessionRef.current === sessionId) {
      return
    }

    loadedProjectsSessionRef.current = sessionId

    void hydrateLastProject(actions, app.capabilities).catch(() => undefined)
  }, [actions, app.backendStatus.sessionId, app.capabilities, canOpenProjects])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isToggleTerminal =
        e.key === "`" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      if (isToggleTerminal) {
        e.preventDefault()
        actions.toggleTerminalDrawer()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [actions])

  async function handleOpenProject() {
    await openProjectFromPicker(
      () => window.ultraShell.pickProjectDirectory(),
      actions,
      app.capabilities,
    )
  }

  return (
    <main className="app-shell">
      <TitleBar
        terminalOpen={app.terminalDrawerOpen}
        onToggleTerminal={() => actions.toggleTerminalDrawer()}
      />

      <section className="app-shell__body">
        <ChatPageShell
          active={app.currentPage === "chat"}
          onOpenProject={() => { void handleOpenProject() }}
        />
        <EditorPageShell active={app.currentPage === "editor"} />
        <BrowserPageShell active={app.currentPage === "browser"} />
      </section>
    </main>
  )
}
