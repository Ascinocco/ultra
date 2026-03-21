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
import {
  parseChatsListResult,
  parseProjectLayoutState,
  parseProjectSnapshot,
  parseProjectsListResult,
  parseSandboxContextSnapshot,
  parseSandboxesListResult,
  parseTerminalListSavedCommandsResult,
  parseTerminalListSessionsResult,
  parseTerminalRuntimeProfileResult,
  parseTerminalSessionSnapshot,
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
  setChatsFetchStatus: (
    projectId: string,
    status: "idle" | "loading" | "error",
  ) => void
  setChatsForProject: (projectId: string, chats: ChatSummary[]) => void
  setSandboxesForProject: (
    projectId: string,
    sandboxes: SandboxContextSnapshot[],
  ) => void
  setActiveSandboxIdForProject: (
    projectId: string,
    sandboxId: string | null,
  ) => void
  setRuntimeProfileForProject: (
    projectId: string,
    runtimeProfile: TerminalRuntimeProfileResult | null,
  ) => void
  setTerminalSessionsForProject: (
    projectId: string,
    sessions: TerminalSessionSnapshot[],
  ) => void
  upsertTerminalSession: (
    projectId: string,
    session: TerminalSessionSnapshot,
  ) => void
  setSavedCommandsForProject: (
    projectId: string,
    commands: SavedCommandSnapshot[],
  ) => void
  setTerminalDrawerOpen: (projectId: string, open: boolean) => void
  setFocusedTerminalSession: (projectId: string, sessionId: string) => void
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

    await hydrateProjectShell(project.id, actions, capabilities, client)

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
  await hydrateProjectShell(lastProject.id, actions, capabilities, client)
}

export async function hydrateProjectShell(
  projectId: string,
  actions: ProjectWorkflowActions,
  capabilities: BackendCapabilities | null,
  client: ProjectWorkflowClient = ipcClient,
): Promise<void> {
  actions.setChatsFetchStatus(projectId, "loading")

  const queries = await Promise.allSettled([
    capabilities?.supportsLayoutPersistence
      ? client.query("projects.get_layout", {
          project_id: projectId,
        })
      : Promise.resolve(null),
    client.query("chats.list", {
      project_id: projectId,
    }),
    client.query("sandboxes.list", {
      project_id: projectId,
    }),
    client.query("sandboxes.get_active", {
      project_id: projectId,
    }),
    client.query("terminal.get_runtime_profile", {
      project_id: projectId,
    }),
    client.query("terminal.list_sessions", {
      project_id: projectId,
    }),
    client.query("terminal.list_saved_commands", {
      project_id: projectId,
    }),
  ])

  const [
    layoutResult,
    chatsResult,
    sandboxesResult,
    activeSandboxResult,
    runtimeResult,
    sessionsResult,
    commandsResult,
  ] = queries

  if (layoutResult?.status === "fulfilled" && layoutResult.value) {
    try {
      const layout = parseProjectLayoutState(layoutResult.value)
      actions.setLayoutForProject(projectId, layout)
      actions.setCurrentPage("chat")
    } catch {
      // Layout restore is best-effort for shell hydration.
    }
  }

  if (chatsResult.status === "fulfilled") {
    try {
      const chats = parseChatsListResult(chatsResult.value).chats
      actions.setChatsForProject(projectId, chats)
    } catch {
      actions.setChatsFetchStatus(projectId, "error")
    }
  } else {
    actions.setChatsFetchStatus(projectId, "error")
  }

  if (sandboxesResult.status === "fulfilled") {
    try {
      const sandboxes = parseSandboxesListResult(
        sandboxesResult.value,
      ).sandboxes
      actions.setSandboxesForProject(projectId, sandboxes)
    } catch {
      // Sandbox hydration is best-effort; preserve the rest of the shell.
    }
  }

  if (activeSandboxResult.status === "fulfilled") {
    try {
      const activeSandbox = parseSandboxContextSnapshot(
        activeSandboxResult.value,
      )
      actions.setActiveSandboxIdForProject(projectId, activeSandbox.sandboxId)
    } catch {
      // Ignore partial active-sandbox restore failures.
    }
  }

  if (runtimeResult.status === "fulfilled") {
    try {
      const runtimeProfile = parseTerminalRuntimeProfileResult(
        runtimeResult.value,
      )
      actions.setRuntimeProfileForProject(projectId, runtimeProfile)
      actions.setActiveSandboxIdForProject(
        projectId,
        runtimeProfile.sandbox.sandboxId,
      )
    } catch {
      // Runtime sync/status is additive to the shell.
    }
  }

  if (sessionsResult.status === "fulfilled") {
    try {
      const sessions = parseTerminalListSessionsResult(
        sessionsResult.value,
      ).sessions
      actions.setTerminalSessionsForProject(projectId, sessions)
    } catch {
      // Session hydration is best-effort.
    }
  }

  if (commandsResult.status === "fulfilled") {
    try {
      const commands = parseTerminalListSavedCommandsResult(
        commandsResult.value,
      ).commands
      actions.setSavedCommandsForProject(projectId, commands)
    } catch {
      // Saved command hydration is best-effort.
    }
  }
}

export async function switchActiveProject(
  projectId: string,
  actions: ProjectWorkflowActions,
  capabilities: BackendCapabilities | null,
  client: ProjectWorkflowClient = ipcClient,
): Promise<void> {
  actions.setActiveProjectId(projectId)
  await hydrateProjectShell(projectId, actions, capabilities, client)
}

export async function switchActiveSandbox(
  projectId: string,
  sandboxId: string,
  actions: ProjectWorkflowActions,
  client: ProjectWorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.command("sandboxes.set_active", {
    project_id: projectId,
    sandbox_id: sandboxId,
  })
  const activeSandbox = parseSandboxContextSnapshot(result)

  actions.setActiveSandboxIdForProject(projectId, activeSandbox.sandboxId)

  // Refresh all state
  const [sandboxesResult, runtimeResult, sessionsResult, commandsResult] =
    await Promise.all([
      client.query("sandboxes.list", {
        project_id: projectId,
      }),
      client.query("terminal.get_runtime_profile", {
        project_id: projectId,
      }),
      client.query("terminal.list_sessions", {
        project_id: projectId,
      }),
      client.query("terminal.list_saved_commands", {
        project_id: projectId,
      }),
    ])

  actions.setSandboxesForProject(
    projectId,
    parseSandboxesListResult(sandboxesResult).sandboxes,
  )
  actions.setRuntimeProfileForProject(
    projectId,
    parseTerminalRuntimeProfileResult(runtimeResult),
  )
  actions.setTerminalSessionsForProject(
    projectId,
    parseTerminalListSessionsResult(sessionsResult).sessions,
  )
  actions.setSavedCommandsForProject(
    projectId,
    parseTerminalListSavedCommandsResult(commandsResult).commands,
  )

}

export async function runSavedCommandForProject(
  projectId: string,
  commandId: "test" | "dev" | "lint" | "build",
  actions: ProjectWorkflowActions,
  client: ProjectWorkflowClient = ipcClient,
): Promise<TerminalSessionSnapshot> {
  const result = await client.command("terminal.run_saved_command", {
    project_id: projectId,
    command_id: commandId,
  })
  const session = parseTerminalSessionSnapshot(result)

  actions.upsertTerminalSession(projectId, session)
  actions.setTerminalDrawerOpen(projectId, true)

  return session
}
