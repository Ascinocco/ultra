import type { ProjectSnapshot } from "@ultra/shared"
import type { AppPage } from "../state/app-store.js"
import { ProjectSelector } from "./ProjectSelector.js"
import { TopNav } from "./TopNav.js"

export interface TitleBarProps {
  currentPage: AppPage
  onSelectPage: (page: AppPage) => void
  activeProject: ProjectSnapshot | null
  recentProjects: ProjectSnapshot[]
  canOpenProjects: boolean
  openStatus: "idle" | "opening" | "error"
  openError: string | null
  onOpenProject: () => void
  onOpenRecentProject: (project: ProjectSnapshot) => void
}

export function TitleBar({
  currentPage,
  onSelectPage,
  activeProject,
  recentProjects,
  canOpenProjects,
  openStatus,
  openError,
  onOpenProject,
  onOpenRecentProject,
}: TitleBarProps) {
  return (
    <div className="title-bar">
      <ProjectSelector
        activeProject={activeProject}
        recentProjects={recentProjects}
        canOpenProjects={canOpenProjects}
        openStatus={openStatus}
        openError={openError}
        onOpenProject={onOpenProject}
        onOpenRecentProject={onOpenRecentProject}
      />
      <TopNav currentPage={currentPage} onSelectPage={onSelectPage} />
      <div />
    </div>
  )
}
