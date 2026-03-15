import type {
  BackendCapabilities,
  ProjectLayoutState,
  ProjectSnapshot,
} from "@ultra/shared"
import {
  parseProjectLayoutState,
  parseProjectSnapshot,
  parseProjectsListResult,
} from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppPage, ProjectOpenStatus } from "../state/app-store.js"

type ProjectWorkflowClient = Pick<typeof ipcClient, "query" | "command">

export type ProjectWorkflowActions = {
  setProjects: (projects: ProjectSnapshot[]) => void
  upsertProject: (project: ProjectSnapshot) => void
  setActiveProjectId: (projectId: string | null) => void
  setProjectOpenState: (
    status: ProjectOpenStatus,
    error?: string | null,
  ) => void
  setLayoutForProject: (projectId: string, layout: ProjectLayoutState) => void
  setCurrentPage: (page: AppPage) => void
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function loadRecentProjects(
  actions: Pick<ProjectWorkflowActions, "setProjects">,
  client: ProjectWorkflowClient = ipcClient,
): Promise<ProjectSnapshot[]> {
  const result = await client.query("projects.list", {})
  const projects = parseProjectsListResult(result).projects

  actions.setProjects(projects)

  return projects
}

export async function openProjectFromPath(
  path: string,
  actions: ProjectWorkflowActions,
  capabilities: BackendCapabilities | null,
  client: ProjectWorkflowClient = ipcClient,
): Promise<ProjectSnapshot> {
  actions.setProjectOpenState("opening", null)

  try {
    const result = await client.command("projects.open", { path })
    const project = parseProjectSnapshot(result)

    actions.upsertProject(project)
    actions.setActiveProjectId(project.id)

    if (capabilities?.supportsLayoutPersistence) {
      try {
        const layoutResult = await client.query("projects.get_layout", {
          project_id: project.id,
        })
        const layout = parseProjectLayoutState(layoutResult)

        actions.setLayoutForProject(project.id, layout)
        actions.setCurrentPage(layout.currentPage)
      } catch {
        // Layout restore is optional until ULR-13 is fully wired.
      }
    }

    try {
      await loadRecentProjects(actions, client)
    } catch {
      // Preserve a successful open even if recent-project refresh fails.
    }

    actions.setProjectOpenState("idle", null)

    return project
  } catch (error) {
    actions.setProjectOpenState("error", getErrorMessage(error))
    throw error
  }
}

export async function openProjectFromPicker(
  pickProjectDirectory: () => Promise<string | null>,
  actions: ProjectWorkflowActions,
  capabilities: BackendCapabilities | null,
  client: ProjectWorkflowClient = ipcClient,
): Promise<ProjectSnapshot | null> {
  if (!capabilities?.supportsProjects) {
    actions.setProjectOpenState(
      "error",
      "Project open is unavailable until the backend connection is ready.",
    )

    return null
  }

  const selectedPath = await pickProjectDirectory()

  if (!selectedPath) {
    actions.setProjectOpenState("idle", null)
    return null
  }

  return openProjectFromPath(selectedPath, actions, capabilities, client)
}

export async function hydrateLastProject(
  actions: ProjectWorkflowActions,
  capabilities: BackendCapabilities | null,
  client: ProjectWorkflowClient = ipcClient,
): Promise<void> {
  const projects = await loadRecentProjects(actions, client)

  if (projects.length === 0) {
    return
  }

  // projects.list returns sorted by lastOpenedAt DESC
  // biome-ignore lint/style/noNonNullAssertion: length checked above
  const lastProject = projects[0]!
  actions.setActiveProjectId(lastProject.id)

  if (capabilities?.supportsLayoutPersistence) {
    try {
      const layoutResult = await client.query("projects.get_layout", {
        project_id: lastProject.id,
      })
      const layout = parseProjectLayoutState(layoutResult)

      actions.setLayoutForProject(lastProject.id, layout)
      actions.setCurrentPage(layout.currentPage)
    } catch {
      // Layout restore is best-effort.
    }
  }
}
