import type { ProjectSnapshot } from "@ultra/shared"
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
  const projects = useAppStore((state) => state.projects)
  const setCurrentPage = useAppStore((state) => state.actions.setCurrentPage)
  const actions = useAppStore((state) => state.actions)
  const loadedProjectsSessionRef = useRef<string | null>(null)

  const activeProject = app.activeProjectId
    ? (projects.byId[app.activeProjectId] ?? null)
    : null
  const recentProjects = projects.allIds
    .map((projectId) => projects.byId[projectId])
    .filter(
      (project): project is ProjectSnapshot =>
        project !== undefined && project.id !== app.activeProjectId,
    )
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

  async function handleOpenProject() {
    await openProjectFromPicker(
      () => window.ultraShell.pickProjectDirectory(),
      actions,
      app.capabilities,
    )
  }

  async function handleOpenRecentProject(project: ProjectSnapshot) {
    await openProjectFromPath(project.rootPath, actions, app.capabilities)
  }

  return (
    <main className="app-shell">
      <TitleBar
        currentPage={app.currentPage}
        onSelectPage={setCurrentPage}
        activeProject={activeProject}
        recentProjects={recentProjects}
        canOpenProjects={canOpenProjects}
        openStatus={app.projectOpenStatus}
        openError={app.projectOpenError}
        onOpenProject={() => {
          void handleOpenProject()
        }}
        onOpenRecentProject={(project) => {
          void handleOpenRecentProject(project)
        }}
      />

      <section className="app-shell__body">
        <ChatPageShell active={app.currentPage === "chat"} />
        <EditorPageShell active={app.currentPage === "editor"} />
        <BrowserPageShell active={app.currentPage === "browser"} />
      </section>
    </main>
  )
}
