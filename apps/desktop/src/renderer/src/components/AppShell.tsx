import type { SandboxContextSnapshot } from "@ultra/shared"
import { useCallback, useEffect, useRef, useState } from "react"

import { ChatPageShell } from "../pages/ChatPageShell.js"
import { SettingsPageShell } from "../pages/SettingsPageShell.js"
import {
  hydrateLastProject,
  openProjectFromPicker,
  switchActiveSandbox,
} from "../projects/project-workflows.js"
import { SandboxSelector } from "../sandbox/SandboxSelector.js"
import { useAppStore } from "../state/app-store.js"
import { openTerminal } from "../terminal/terminal-workflows.js"
import { TitleBar } from "./TitleBar.js"

export function AppShell() {
  const [showSettings, setShowSettings] = useState(false)
  const app = useAppStore((state) => state.app)
  const actions = useAppStore((state) => state.actions)
  const sandboxes = useAppStore((state) => state.sandboxes)
  const terminal = useAppStore((state) => state.terminal)
  const loadedProjectsSessionRef = useRef<string | null>(null)

  const layout = useAppStore((state) => state.layout)

  const activeProjectId = app.activeProjectId
  const sidebarCollapsed = activeProjectId
    ? (layout.byProjectId[activeProjectId]?.sidebarCollapsed ?? false)
    : false

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

  const handleToggleTerminal = useCallback(() => {
    if (!activeProjectId) return
    const isOpen = terminal.drawerOpenByProjectId[activeProjectId] ?? false
    const currentSandboxId = sandboxes.activeByProjectId[activeProjectId] ?? null
    const sessions = terminal.sessionsByProjectId[activeProjectId] ?? []

    // Check if the ACTIVE SANDBOX has a running session (not just any session)
    const hasSessionForActiveSandbox = currentSandboxId
      ? sessions.some((s) => s.status === "running" && s.sandboxId === currentSandboxId)
      : sessions.some((s) => s.status === "running")

    if (!isOpen && !hasSessionForActiveSandbox) {
      // No running session for the active sandbox: create one and open the drawer
      void openTerminal(activeProjectId, actions, undefined,
        currentSandboxId ? { sandboxId: currentSandboxId } : undefined,
      )
    } else if (!isOpen && hasSessionForActiveSandbox) {
      // Has a session for this sandbox — focus it and open
      const sandboxSession = currentSandboxId
        ? sessions.find((s) => s.status === "running" && s.sandboxId === currentSandboxId)
        : sessions.find((s) => s.status === "running")
      if (sandboxSession) {
        actions.setFocusedTerminalSession(activeProjectId, sandboxSession.sessionId)
      }
      actions.setTerminalDrawerOpen(activeProjectId, true)
    } else {
      actions.setTerminalDrawerOpen(activeProjectId, !isOpen)
    }
  }, [
    activeProjectId,
    actions,
    terminal.drawerOpenByProjectId,
    terminal.sessionsByProjectId,
    sandboxes.activeByProjectId,
  ])

  const handleToggleSidebar = useCallback(() => {
    if (!activeProjectId) return
    actions.setLayoutField(activeProjectId, {
      sidebarCollapsed: !sidebarCollapsed,
    })
  }, [activeProjectId, actions, sidebarCollapsed])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isToggleTerminal =
        e.key === "`" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      if (isToggleTerminal) {
        e.preventDefault()
        if (!activeProjectId) return
        handleToggleTerminal()
      }

      const isToggleSidebar =
        e.key === "b" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      if (isToggleSidebar && !showSettings) {
        e.preventDefault()
        handleToggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeProjectId, handleToggleTerminal, handleToggleSidebar, showSettings])

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
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
      >
        <SandboxSelector
          activeSandbox={activeSandbox}
          sandboxes={projectSandboxes}
          onSelect={handleSandboxSelect}
        />
      </TitleBar>

      <section className="app-shell__body">
        {showSettings ? (
          <SettingsPageShell onBack={() => setShowSettings(false)} />
        ) : (
          <ChatPageShell
            onOpenProject={() => {
              void handleOpenProject()
            }}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
      </section>
    </main>
  )
}
