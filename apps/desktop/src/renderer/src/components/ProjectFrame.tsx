import { APP_NAME } from "@ultra/shared"

export function ProjectFrame({
  activeProjectId,
}: {
  activeProjectId: string | null
}) {
  return (
    <div className="project-frame">
      <p className="project-frame__eyebrow">{APP_NAME}</p>
      <div className="project-frame__identity">
        <strong>
          {activeProjectId ? activeProjectId : "No project selected"}
        </strong>
        <span>
          {activeProjectId
            ? "Project-scoped state will appear here once project open lands."
            : "Project open arrives in the next foundation tickets."}
        </span>
      </div>
    </div>
  )
}
