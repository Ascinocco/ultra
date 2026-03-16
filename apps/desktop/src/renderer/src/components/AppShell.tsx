import type { SandboxContextSnapshot } from "@ultra/shared"
import { useEffect, useRef } from "react"

import { ChatPageShell } from "../pages/ChatPageShell.js"
import {
  hydrateLastProject,
  openProjectFromPicker,
} from "../projects/project-workflows.js"
import { SandboxSelector } from "../sandbox/SandboxSelector.js"
import { switchActiveSandbox } from "../projects/project-workflows.js"
import { openTerminal } from "../terminal/terminal-workflows.js"
import { useAppStore } from "../state/app-store.js"
import { TitleBar } from "./TitleBar.js"

export function AppShell() {
  const app = useAppStore((state) => state.app)
  const actions = useAppStore((state) => state.actions)
  const sandboxes = useAppStore((state) => state.sandboxes)
  const terminal = useAppStore((state) => state.terminal)
  const loadedProjectsSessionRef = useRef<string | null>(null)

  const activeProjectId = app.activeProjectId

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
        if (!activeProjectId) return
        handleToggleTerminal()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [actions, activeProjectId, terminal.drawerOpenByProjectId, terminal.sessionsByProjectId])

  const terminalOpen = activeProjectId
    ? (terminal.drawerOpenByProjectId[activeProjectId] ?? false)
    : false

  const projectSandboxes = activeProjectId
    ? (sandboxes.idsByProjectId[activeProjectId] ?? [])
        .map((id) => sandboxes.byId[id])
        .filter((sb): sb is SandboxContextSnapshot => Boolean(sb))
    : []

  const activeSandboxId = activeProjectId
    ? (sandboxes.activeByProjectId[activeProjectId] ?? null)
    : null

  const activeSandbox = activeSandboxId
    ? (sandboxes.byId[activeSandboxId] ?? null)
    : null

  function handleToggleTerminal() {
    if (!activeProjectId) return
    const isOpen = terminal.drawerOpenByProjectId[activeProjectId] ?? false
    const hasSessions = (terminal.sessionsByProjectId[activeProjectId] ?? []).length > 0

    if (!isOpen && !hasSessions) {
      // First open: create a session via backend
      void openTerminal(activeProjectId, actions)
    } else {
      actions.setTerminalDrawerOpen(activeProjectId, !isOpen)
    }
  }

  function handleSandboxSelect(sandboxId: string) {
    if (!activeProjectId) return
    void switchActiveSandbox(activeProjectId, sandboxId, actions).catch(
      () => undefined,
    )
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
        terminalOpen={terminalOpen}
        onToggleTerminal={handleToggleTerminal}
      >
        <SandboxSelector
          activeSandbox={activeSandbox}
          sandboxes={projectSandboxes}
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
