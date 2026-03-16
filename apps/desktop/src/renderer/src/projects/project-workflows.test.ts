import type {
  BackendCapabilities,
  ChatSummary,
  ProjectLayoutState,
  ProjectSnapshot,
  SandboxContextSnapshot,
  SavedCommandSnapshot,
  TerminalRuntimeProfileResult,
  TerminalSessionSnapshot,
} from "@ultra/shared"
import { describe, expect, it, vi } from "vitest"

import type { AppPage } from "../state/app-store.js"
import {
  hydrateLastProject,
  hydrateProjectShell,
  loadRecentProjects,
  openProjectFromPath,
  openProjectFromPicker,
  type ProjectWorkflowActions,
  runSavedCommandForProject,
  switchActiveProject,
  switchActiveSandbox,
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
    setChatsFetchStatus: vi.fn(),
    setChatsForProject:
      vi.fn<(projectId: string, chats: ChatSummary[]) => void>(),
    setSandboxesForProject:
      vi.fn<(projectId: string, sandboxes: SandboxContextSnapshot[]) => void>(),
    setActiveSandboxIdForProject: vi.fn(),
    setRuntimeProfileForProject:
      vi.fn<
        (
          projectId: string,
          runtimeProfile: TerminalRuntimeProfileResult | null,
        ) => void
      >(),
    setTerminalSessionsForProject:
      vi.fn<(projectId: string, sessions: TerminalSessionSnapshot[]) => void>(),
    upsertTerminalSession:
      vi.fn<(projectId: string, session: TerminalSessionSnapshot) => void>(),
    setSavedCommandsForProject:
      vi.fn<(projectId: string, commands: SavedCommandSnapshot[]) => void>(),
    setTerminalDrawerOpen: vi.fn(),
  }
}

const projectCapabilities: BackendCapabilities = {
  supportsProjects: true,
  supportsLayoutPersistence: false,
  supportsSubscriptions: true,
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
    expect(actions.setCurrentPage).toHaveBeenCalledWith("chat")
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
      supportsSubscriptions: true,
      supportsBackendInfo: true,
    }

    await hydrateLastProject(actions, capabilities, client)

    expect(actions.setProjects).toHaveBeenCalled()
    expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
    expect(client.query).toHaveBeenNthCalledWith(2, "projects.get_layout", {
      project_id: "proj-1",
    })
    expect(actions.setLayoutForProject).toHaveBeenCalledWith("proj-1", layout)
    expect(actions.setCurrentPage).toHaveBeenCalledWith("chat")
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
      supportsSubscriptions: true,
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
        projects: [{ ...recentProject, lastOpenedAt: "2026-03-15T12:00:00Z" }],
      }),
      command: vi.fn(),
    }

    const capabilities: BackendCapabilities = {
      supportsProjects: true,
      supportsLayoutPersistence: false,
      supportsSubscriptions: true,
      supportsBackendInfo: true,
    }

    await hydrateLastProject(actions, capabilities, client)

    expect(actions.setProjects).toHaveBeenCalled()
    expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
    expect(actions.setLayoutForProject).not.toHaveBeenCalled()
  })

  it("hydrates project-scoped chats, sandboxes, runtime, sessions, and commands", async () => {
    const actions = makeActions()
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          currentPage: "editor",
          rightTopCollapsed: false,
          rightBottomCollapsed: true,
          selectedRightPaneTab: null,
          selectedBottomPaneTab: "terminal",
          activeChatId: "chat-1",
          selectedThreadId: null,
          lastEditorTargetId: null,
        })
        .mockResolvedValueOnce({
          chats: [
            {
              id: "chat-1",
              projectId: "proj-1",
              title: "Alpha chat",
              status: "active",
              provider: "claude",
              model: "claude-sonnet-4-6",
              thinkingLevel: "normal",
              permissionLevel: "supervised",
              isPinned: false,
              pinnedAt: null,
              archivedAt: null,
              lastCompactedAt: null,
              currentSessionId: null,
              createdAt: "2026-03-14T00:00:00Z",
              updatedAt: "2026-03-14T00:00:00Z",
            },
          ],
        })
        .mockResolvedValueOnce({
          sandboxes: [
            {
              sandboxId: "sandbox-1",
              projectId: "proj-1",
              threadId: null,
              path: "/projects/alpha",
              displayName: "Main",
              sandboxType: "main_checkout",
              branchName: "main",
              baseBranch: "main",
              isMainCheckout: true,
              createdAt: "2026-03-14T00:00:00Z",
              updatedAt: "2026-03-14T00:00:00Z",
              lastUsedAt: "2026-03-14T00:00:00Z",
            },
          ],
        })
        .mockResolvedValueOnce({
          sandboxId: "sandbox-1",
          projectId: "proj-1",
          threadId: null,
          path: "/projects/alpha",
          displayName: "Main",
          sandboxType: "main_checkout",
          branchName: "main",
          baseBranch: "main",
          isMainCheckout: true,
          createdAt: "2026-03-14T00:00:00Z",
          updatedAt: "2026-03-14T00:00:00Z",
          lastUsedAt: "2026-03-14T00:00:00Z",
        })
        .mockResolvedValueOnce({
          sandbox: {
            sandboxId: "sandbox-1",
            projectId: "proj-1",
            threadId: null,
            path: "/projects/alpha",
            displayName: "Main",
            sandboxType: "main_checkout",
            branchName: "main",
            baseBranch: "main",
            isMainCheckout: true,
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
            lastUsedAt: "2026-03-14T00:00:00Z",
          },
          profile: {
            projectId: "proj-1",
            runtimeFilePaths: [".env"],
            envVars: {},
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
          },
          sync: {
            syncId: "sync-1",
            sandboxId: "sandbox-1",
            projectId: "proj-1",
            syncMode: "managed_copy",
            status: "synced",
            syncedFiles: [".env"],
            lastSyncedAt: "2026-03-14T00:00:00Z",
            details: null,
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
          },
        })
        .mockResolvedValueOnce({
          sessions: [],
        })
        .mockResolvedValueOnce({
          commands: [
            {
              commandId: "test",
              label: "Test",
              commandLine: "pnpm test",
              isAvailable: true,
              reasonUnavailable: null,
            },
          ],
        }),
      command: vi.fn(),
    }

    await hydrateProjectShell(
      "proj-1",
      actions,
      { ...projectCapabilities, supportsLayoutPersistence: true },
      client,
    )

    expect(actions.setChatsFetchStatus).toHaveBeenCalledWith(
      "proj-1",
      "loading",
    )
    expect(actions.setChatsForProject).toHaveBeenCalled()
    expect(actions.setSandboxesForProject).toHaveBeenCalled()
    expect(actions.setActiveSandboxIdForProject).toHaveBeenCalledWith(
      "proj-1",
      "sandbox-1",
    )
    expect(actions.setRuntimeProfileForProject).toHaveBeenCalled()
    expect(actions.setTerminalSessionsForProject).toHaveBeenCalledWith(
      "proj-1",
      [],
    )
    expect(actions.setSavedCommandsForProject).toHaveBeenCalled()
  })

  it("switches projects and rehydrates shell state", async () => {
    const actions = makeActions()
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ chats: [] })
        .mockResolvedValueOnce({ sandboxes: [] })
        .mockResolvedValueOnce({
          sandboxId: "sandbox-1",
          projectId: "proj-1",
          threadId: null,
          path: "/projects/alpha",
          displayName: "Main",
          sandboxType: "main_checkout",
          branchName: "main",
          baseBranch: "main",
          isMainCheckout: true,
          createdAt: "2026-03-14T00:00:00Z",
          updatedAt: "2026-03-14T00:00:00Z",
          lastUsedAt: "2026-03-14T00:00:00Z",
        })
        .mockResolvedValueOnce({
          sandbox: {
            sandboxId: "sandbox-1",
            projectId: "proj-1",
            threadId: null,
            path: "/projects/alpha",
            displayName: "Main",
            sandboxType: "main_checkout",
            branchName: "main",
            baseBranch: "main",
            isMainCheckout: true,
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
            lastUsedAt: "2026-03-14T00:00:00Z",
          },
          profile: {
            projectId: "proj-1",
            runtimeFilePaths: [".env"],
            envVars: {},
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
          },
          sync: {
            syncId: "sync-1",
            sandboxId: "sandbox-1",
            projectId: "proj-1",
            syncMode: "managed_copy",
            status: "unknown",
            syncedFiles: [],
            lastSyncedAt: null,
            details: null,
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
          },
        })
        .mockResolvedValueOnce({ sessions: [] })
        .mockResolvedValueOnce({ commands: [] }),
      command: vi.fn(),
    }

    await switchActiveProject("proj-1", actions, projectCapabilities, client)

    expect(actions.setActiveProjectId).toHaveBeenCalledWith("proj-1")
    expect(actions.setSandboxesForProject).toHaveBeenCalled()
  })

  it("switches active sandbox and refreshes runtime and terminal snapshots", async () => {
    const actions = makeActions()
    const client = {
      command: vi.fn(async () => ({
        sandboxId: "sandbox-2",
        projectId: "proj-1",
        threadId: null,
        path: "/projects/alpha/.worktrees/thread",
        displayName: "Thread",
        sandboxType: "thread_sandbox",
        branchName: "thread",
        baseBranch: "main",
        isMainCheckout: false,
        createdAt: "2026-03-14T00:00:00Z",
        updatedAt: "2026-03-14T00:00:00Z",
        lastUsedAt: "2026-03-14T00:00:00Z",
      })),
      query: vi
        .fn()
        .mockResolvedValueOnce({ sandboxes: [] })
        .mockResolvedValueOnce({
          sandbox: {
            sandboxId: "sandbox-2",
            projectId: "proj-1",
            threadId: null,
            path: "/projects/alpha/.worktrees/thread",
            displayName: "Thread",
            sandboxType: "thread_sandbox",
            branchName: "thread",
            baseBranch: "main",
            isMainCheckout: false,
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
            lastUsedAt: "2026-03-14T00:00:00Z",
          },
          profile: {
            projectId: "proj-1",
            runtimeFilePaths: [".env"],
            envVars: {},
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
          },
          sync: {
            syncId: "sync-1",
            sandboxId: "sandbox-2",
            projectId: "proj-1",
            syncMode: "managed_copy",
            status: "synced",
            syncedFiles: [".env"],
            lastSyncedAt: "2026-03-14T00:00:00Z",
            details: null,
            createdAt: "2026-03-14T00:00:00Z",
            updatedAt: "2026-03-14T00:00:00Z",
          },
        })
        .mockResolvedValueOnce({ sessions: [] })
        .mockResolvedValueOnce({ commands: [] }),
    }

    await switchActiveSandbox("proj-1", "sandbox-2", actions, client)

    expect(client.command).toHaveBeenCalledWith("sandboxes.set_active", {
      project_id: "proj-1",
      sandbox_id: "sandbox-2",
    })
    expect(actions.setActiveSandboxIdForProject).toHaveBeenCalledWith(
      "proj-1",
      "sandbox-2",
    )
    expect(actions.setRuntimeProfileForProject).toHaveBeenCalled()
  })

  it("runs a saved command, stores the session, and opens the drawer", async () => {
    const actions = makeActions()
    const client = {
      command: vi.fn(async () => ({
        sessionId: "term-1",
        projectId: "proj-1",
        sandboxId: "sandbox-1",
        threadId: null,
        cwd: "/projects/alpha",
        title: "Test · Main",
        sessionKind: "saved_command",
        status: "running",
        commandId: "test",
        commandLabel: "Test",
        commandLine: "pnpm test",
        exitCode: null,
        startedAt: "2026-03-14T00:00:00Z",
        updatedAt: "2026-03-14T00:00:00Z",
        lastOutputAt: null,
        lastOutputSequence: 0,
        recentOutput: "",
      })),
      query: vi.fn(),
    }

    await runSavedCommandForProject("proj-1", "test", actions, client)

    expect(client.command).toHaveBeenCalledWith("terminal.run_saved_command", {
      project_id: "proj-1",
      command_id: "test",
    })
    expect(actions.upsertTerminalSession).toHaveBeenCalled()
    expect(actions.setTerminalDrawerOpen).toHaveBeenCalledWith("proj-1", true)
  })
})
