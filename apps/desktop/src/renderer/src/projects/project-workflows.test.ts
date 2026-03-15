import type {
  BackendCapabilities,
  ProjectLayoutState,
  ProjectSnapshot,
} from "@ultra/shared"
import { describe, expect, it, vi } from "vitest"

import type { AppPage } from "../state/app-store.js"
import {
  hydrateLastProject,
  loadRecentProjects,
  openProjectFromPath,
  openProjectFromPicker,
  type ProjectWorkflowActions,
} from "./project-workflows.js"

function makeProject(id: string, name: string): ProjectSnapshot {
  return {
    id,
    key: name.toLowerCase(),
    name,
    rootPath: `/projects/${name.toLowerCase()}`,
    gitRootPath: null,
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    lastOpenedAt: "2026-03-14T00:00:00Z",
  }
}

function makeActions(): ProjectWorkflowActions {
  return {
    setProjects: vi.fn(),
    upsertProject: vi.fn(),
    setActiveProjectId: vi.fn(),
    setProjectOpenState: vi.fn(),
    setLayoutForProject: vi.fn(),
    setCurrentPage: vi.fn<(page: AppPage) => void>(),
  }
}

const projectCapabilities: BackendCapabilities = {
  supportsProjects: true,
  supportsLayoutPersistence: false,
  supportsSubscriptions: false,
  supportsBackendInfo: true,
}

describe("project workflows", () => {
  it("loads recent projects and preserves backend order", async () => {
    const actions = makeActions()
    const client = {
      query: vi.fn(async () => ({
        projects: [
          makeProject("proj-2", "Beta"),
          makeProject("proj-1", "Alpha"),
        ],
      })),
      command: vi.fn(),
    }

    const projects = await loadRecentProjects(actions, client)

    expect(client.query).toHaveBeenCalledWith("projects.list", {})
    expect(actions.setProjects).toHaveBeenCalledWith(projects)
    expect(projects.map((project) => project.id)).toEqual(["proj-2", "proj-1"])
  })

  it("opens a project from the picker and hydrates the active project", async () => {
    const actions = makeActions()
    const project = makeProject("proj-1", "Alpha")
    const client = {
      command: vi.fn(async () => project),
      query: vi.fn().mockResolvedValueOnce({
        projects: [project],
      }),
    }

    const result = await openProjectFromPicker(
      async () => "/tmp/alpha",
      actions,
      projectCapabilities,
      client,
    )

    expect(result).toEqual(project)
    expect(client.command).toHaveBeenCalledWith("projects.open", {
      path: "/tmp/alpha",
    })
    expect(actions.upsertProject).toHaveBeenCalledWith(project)
    expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
    expect(actions.setProjectOpenState).toHaveBeenNthCalledWith(
      1,
      "opening",
      null,
    )
    expect(actions.setProjectOpenState).toHaveBeenLastCalledWith("idle", null)
  })

  it("treats picker cancellation as a clean no-op", async () => {
    const actions = makeActions()
    const client = {
      command: vi.fn(),
      query: vi.fn(),
    }

    const result = await openProjectFromPicker(
      async () => null,
      actions,
      projectCapabilities,
      client,
    )

    expect(result).toBeNull()
    expect(client.command).not.toHaveBeenCalled()
    expect(actions.setProjectOpenState).toHaveBeenCalledWith("idle", null)
  })

  it("surfaces project-open failures through the action state", async () => {
    const actions = makeActions()
    const client = {
      command: vi.fn(async () => {
        throw new Error("Invalid project directory")
      }),
      query: vi.fn(),
    }

    await expect(
      openProjectFromPath("/tmp/missing", actions, projectCapabilities, client),
    ).rejects.toThrow("Invalid project directory")

    expect(actions.setProjectOpenState).toHaveBeenLastCalledWith(
      "error",
      "Invalid project directory",
    )
  })

  it("restores layout when the backend advertises layout persistence", async () => {
    const actions = makeActions()
    const project = makeProject("proj-1", "Alpha")
    const layout: ProjectLayoutState = {
      currentPage: "editor",
      rightTopCollapsed: false,
      rightBottomCollapsed: true,
      selectedRightPaneTab: "timeline",
      selectedBottomPaneTab: null,
      activeChatId: null,
      selectedThreadId: null,
      lastEditorTargetId: null,
    }
    const client = {
      command: vi.fn(async () => project),
      query: vi
        .fn()
        .mockResolvedValueOnce(layout)
        .mockResolvedValueOnce({ projects: [project] }),
    }

    await openProjectFromPath(
      "/tmp/alpha",
      actions,
      { ...projectCapabilities, supportsLayoutPersistence: true },
      client,
    )

    expect(client.query).toHaveBeenNthCalledWith(1, "projects.get_layout", {
      project_id: "proj-1",
    })
    expect(actions.setLayoutForProject).toHaveBeenCalledWith("proj-1", layout)
    expect(actions.setCurrentPage).toHaveBeenCalledWith("editor")
  })

  it("hydrateLastProject restores the most recently opened project and its layout", async () => {
    const actions = makeActions()
    const recentProject = makeProject("proj-1", "Alpha")
    const olderProject = makeProject("proj-2", "Beta")
    const layout: ProjectLayoutState = {
      currentPage: "browser",
      rightTopCollapsed: true,
      rightBottomCollapsed: false,
      selectedRightPaneTab: null,
      selectedBottomPaneTab: null,
      activeChatId: "chat_1",
      selectedThreadId: null,
      lastEditorTargetId: null,
    }

    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          projects: [
            { ...recentProject, lastOpenedAt: "2026-03-15T12:00:00Z" },
            { ...olderProject, lastOpenedAt: "2026-03-14T12:00:00Z" },
          ],
        })
        .mockResolvedValueOnce(layout),
      command: vi.fn(),
    }

    const capabilities: BackendCapabilities = {
      supportsProjects: true,
      supportsLayoutPersistence: true,
      supportsSubscriptions: false,
      supportsBackendInfo: true,
    }

    await hydrateLastProject(actions, capabilities, client)

    expect(actions.setProjects).toHaveBeenCalled()
    expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
    expect(client.query).toHaveBeenNthCalledWith(2, "projects.get_layout", {
      project_id: "proj-1",
    })
    expect(actions.setLayoutForProject).toHaveBeenCalledWith("proj-1", layout)
    expect(actions.setCurrentPage).toHaveBeenCalledWith("browser")
  })

  it("hydrateLastProject is a no-op when no projects exist", async () => {
    const actions = makeActions()
    const client = {
      query: vi.fn().mockResolvedValueOnce({ projects: [] }),
      command: vi.fn(),
    }

    const capabilities: BackendCapabilities = {
      supportsProjects: true,
      supportsLayoutPersistence: true,
      supportsSubscriptions: false,
      supportsBackendInfo: true,
    }

    await hydrateLastProject(actions, capabilities, client)

    expect(actions.setProjects).toHaveBeenCalledWith([])
    expect(actions.setActiveProjectId).not.toHaveBeenCalled()
    expect(actions.setLayoutForProject).not.toHaveBeenCalled()
  })

  it("hydrateLastProject skips layout restore when capability is off", async () => {
    const actions = makeActions()
    const recentProject = makeProject("proj-1", "Alpha")
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        projects: [
          { ...recentProject, lastOpenedAt: "2026-03-15T12:00:00Z" },
        ],
      }),
      command: vi.fn(),
    }

    const capabilities: BackendCapabilities = {
      supportsProjects: true,
      supportsLayoutPersistence: false,
      supportsSubscriptions: false,
      supportsBackendInfo: true,
    }

    await hydrateLastProject(actions, capabilities, client)

    expect(actions.setProjects).toHaveBeenCalled()
    expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
    expect(actions.setLayoutForProject).not.toHaveBeenCalled()
  })
})
