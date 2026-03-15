import { APP_NAME, type ProjectSnapshot } from "@ultra/shared"

export function ProjectFrame({
  activeProject,
  recentProjects,
  canOpenProjects,
  openStatus,
  openError,
  onOpenProject,
  onOpenRecentProject,
}: {
  activeProject: ProjectSnapshot | null
  recentProjects: ProjectSnapshot[]
  canOpenProjects: boolean
  openStatus: "idle" | "opening" | "error"
  openError: string | null
  onOpenProject: () => void
  onOpenRecentProject: (project: ProjectSnapshot) => void
}) {
  const isOpening = openStatus === "opening"
  const primaryActionLabel = activeProject ? "Switch Project" : "Open Project"

  return (
    <div className="project-frame">
      <p className="project-frame__eyebrow">{APP_NAME}</p>
      {activeProject ? (
        <div className="project-frame__identity">
          <div className="project-frame__title-row">
            <strong>{activeProject.name}</strong>
            <button
              className="project-frame__button project-frame__button--inline"
              disabled={!canOpenProjects || isOpening}
              type="button"
              onClick={onOpenProject}
            >
              {isOpening ? "Opening…" : primaryActionLabel}
            </button>
          </div>
          <span className="project-frame__path">{activeProject.rootPath}</span>
          {activeProject.gitRootPath &&
          activeProject.gitRootPath !== activeProject.rootPath ? (
            <span className="project-frame__meta">
              Repo root: {activeProject.gitRootPath}
            </span>
          ) : null}
        </div>
      ) : null}
      {!activeProject ? (
        <div className="project-frame__actions">
          <button
            className="project-frame__button"
            disabled={!canOpenProjects || isOpening}
            type="button"
            onClick={onOpenProject}
          >
            {isOpening ? "Opening…" : primaryActionLabel}
          </button>
        </div>
      ) : null}
      {openError ? <p className="project-frame__error">{openError}</p> : null}
      {recentProjects.length > 0 ? (
        <div className="project-frame__recent">
          <p className="project-frame__recent-label">Recent projects</p>
          <div className="project-frame__recent-list">
            {recentProjects.slice(0, 3).map((project) => (
              <button
                key={project.id}
                className="project-frame__recent-button"
                disabled={!canOpenProjects || isOpening}
                type="button"
                onClick={() => {
                  onOpenRecentProject(project)
                }}
              >
                <span>{project.name}</span>
                <small>{project.rootPath}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
