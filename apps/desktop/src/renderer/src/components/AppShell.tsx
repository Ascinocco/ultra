import { useEffect, useRef } from "react"

import { ChatPageShell } from "../pages/ChatPageShell.js"
import {
  hydrateLastProject,
  openProjectFromPicker,
} from "../projects/project-workflows.js"
import { SandboxSelector } from "../sandbox/SandboxSelector.js"
import { hydrateSandboxes, switchSandbox } from "../sandbox/sandbox-workflows.js"
import { useAppStore } from "../state/app-store.js"
import { TitleBar } from "./TitleBar.js"

export function AppShell() {
  const app = useAppStore((state) => state.app)
  const actions = useAppStore((state) => state.actions)
  const sandbox = useAppStore((state) => state.sandbox)
  const loadedProjectsSessionRef = useRef<string | null>(null)
  const hydratedSandboxProjectRef = useRef<string | null>(null)

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
    if (!app.activeProjectId) {
      hydratedSandboxProjectRef.current = null
      return
    }
    if (hydratedSandboxProjectRef.current === app.activeProjectId) return
    hydratedSandboxProjectRef.current = app.activeProjectId
    void hydrateSandboxes(app.activeProjectId, actions)
  }, [app.activeProjectId, actions])

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

  function handleSandboxSelect(sandboxId: string) {
    if (!app.activeProjectId) return
    void switchSandbox(app.activeProjectId, sandboxId, actions).catch(() => undefined)
  }

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
      >
        <SandboxSelector
          activeSandbox={sandbox.activeSandbox}
          sandboxes={sandbox.sandboxes}
          onSelect={handleSandboxSelect}
        />
      </TitleBar>

      <section className="app-shell__body">
        <ChatPageShell
          onOpenProject={() => {
            void handleOpenProject()
          }}
        />
      </section>
    </main>
  )
}
