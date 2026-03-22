import type { ChatSummary } from "@ultra/shared"
import { useEffect, useRef, useState } from "react"

import { ipcClient } from "../ipc/ipc-client.js"
import { switchActiveProject } from "../projects/project-workflows.js"
import { useAppStore } from "../state/app-store.js"
import { ChatContextMenu, type ContextMenuState } from "./ChatContextMenu.js"
import { ProjectGroup } from "./ProjectGroup.js"
import { ProjectSettingsModal } from "./ProjectSettingsModal.js"
import {
  archiveChat,
  createChat,
  loadChatsForProject,
  pinChat,
  renameChat,
  unpinChat,
} from "./chat-workflows.js"

export function resolveRenamedChatTitle(
  currentTitle: string,
  candidateTitle: string,
): string | null {
  const trimmedTitle = candidateTitle.trim()
  if (!trimmedTitle || trimmedTitle === currentTitle) return null
  return trimmedTitle
}

export function Sidebar({
  onOpenProject,
  onOpenSettings,
}: {
  onOpenProject: () => void
  onOpenSettings: () => void
}) {
  const projects = useAppStore((s) => s.projects)
  const sidebar = useAppStore((s) => s.sidebar)
  const activeProjectId = useAppStore((s) => s.app.activeProjectId)
  const capabilities = useAppStore((s) => s.app.capabilities)
  const layout = useAppStore((s) => s.layout)
  const actions = useAppStore((s) => s.actions)

  const readiness = useAppStore((s) => s.readiness)
  const readinessHasIssues = readiness.status === "blocked" || readiness.status === "error"

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null)
  const [settingsFilePaths, setSettingsFilePaths] = useState<string[]>([])

  async function handleOpenSettings(projectId: string) {
    try {
      const result = await ipcClient.query("terminal.get_runtime_profile", {
        project_id: projectId,
      })
      const profile = (result as any).profile ?? result
      setSettingsFilePaths(profile?.runtimeFilePaths ?? [".env"])
    } catch {
      setSettingsFilePaths([".env"])
    }
    setSettingsProjectId(projectId)
  }

  async function handleSaveSettings(filePaths: string[]) {
    if (!settingsProjectId) return
    try {
      await ipcClient.command("terminal.update_runtime_file_paths", {
        project_id: settingsProjectId,
        runtime_file_paths: filePaths,
      })
    } catch (err) {
      console.error("[sidebar] failed to save runtime file paths:", err)
    }
  }
  const prevActiveProjectRef = useRef<string | null>(null)

  // Auto-expand the active project when it first becomes active
  useEffect(() => {
    if (
      activeProjectId &&
      activeProjectId !== prevActiveProjectRef.current &&
      !sidebar.expandedProjectIds.includes(activeProjectId)
    ) {
      actions.toggleProjectExpanded(activeProjectId)
    }
    prevActiveProjectRef.current = activeProjectId
  }, [activeProjectId, actions, sidebar.expandedProjectIds])

  const activeChatId = activeProjectId
    ? (layout.byProjectId[activeProjectId]?.activeChatId ?? null)
    : null

  function handleSelectChat(chatId: string, projectId: string) {
    if (projectId !== activeProjectId) {
      void switchActiveProject(projectId, actions, capabilities)
    }
    actions.setLayoutField(projectId, { activeChatId: chatId })
  }

  function handleNewChat(projectId: string) {
    void createChat(projectId, actions).then((chat) => {
      actions.setLayoutField(projectId, { activeChatId: chat.id })
    })
  }

  function handleChatContextMenu(event: React.MouseEvent, chat: ChatSummary) {
    event.preventDefault()
    setContextMenu({ chat, x: event.clientX, y: event.clientY })
  }

  function handleRename(chat: ChatSummary) {
    setRenamingChatId(chat.id)
    setRenameDraft(chat.title)
  }

  function handleRenameCommit(chat: ChatSummary) {
    if (renamingChatId !== chat.id) return
    const nextTitle = resolveRenamedChatTitle(chat.title, renameDraft)
    if (nextTitle) {
      void renameChat(chat.id, nextTitle, actions)
    }
    setRenamingChatId(null)
    setRenameDraft("")
  }

  function handleRenameCancel() {
    setRenamingChatId(null)
    setRenameDraft("")
  }

  function handleTogglePin(chat: ChatSummary) {
    if (chat.isPinned) {
      void unpinChat(chat.id, actions)
    } else {
      void pinChat(chat.id, actions)
    }
  }

  function handleArchive(chat: ChatSummary) {
    void archiveChat(chat.id, chat.projectId, actions)
  }

  function handleToggleExpand(projectId: string) {
    actions.toggleProjectExpanded(projectId)

    // Auto-switch active project when expanding
    if (projectId !== activeProjectId) {
      void switchActiveProject(projectId, actions, capabilities)
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar__body">
        <p className="sidebar__section-label">Projects</p>

        {projects.allIds.length === 0 ? (
          <p className="sidebar__status-copy">
            Open a project to get started.
          </p>
        ) : (
          projects.allIds.map((projectId) => {
            const project = projects.byId[projectId]
            if (!project) return null

            const isExpanded =
              sidebar.expandedProjectIds.includes(projectId)

            return (
              <ProjectGroup
                key={projectId}
                project={project}
                isExpanded={isExpanded}
                chats={sidebar.chatsByProjectId[projectId] ?? []}
                fetchStatus={sidebar.chatsFetchStatus[projectId]}
                activeChatId={
                  projectId === activeProjectId ? activeChatId : null
                }
                onToggleExpand={() => handleToggleExpand(projectId)}
                onSelectChat={(chatId) =>
                  handleSelectChat(chatId, projectId)
                }
                onChatContextMenu={handleChatContextMenu}
                onRetryFetch={() =>
                  void loadChatsForProject(projectId, actions)
                }
                onNewChat={() => handleNewChat(projectId)}
                onOpenSettings={() => void handleOpenSettings(projectId)}
                renamingChatId={renamingChatId}
                renameDraft={renameDraft}
                onRenameDraftChange={setRenameDraft}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={handleRenameCancel}
              />
            )
          })
        )}
      </div>

      <div className="sidebar__footer">
        <button
          className="sidebar__settings"
          type="button"
          onClick={onOpenSettings}
        >
          Settings
          {readinessHasIssues && <span className="sidebar__settings-alert" />}
        </button>
        <button
          className="sidebar__open-project"
          type="button"
          onClick={onOpenProject}
        >
          Open Project
        </button>
      </div>

      <ChatContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onRename={handleRename}
        onTogglePin={handleTogglePin}
        onArchive={handleArchive}
      />

      {settingsProjectId && (
        <ProjectSettingsModal
          projectId={settingsProjectId}
          currentFilePaths={settingsFilePaths}
          onSave={handleSaveSettings}
          onClose={() => setSettingsProjectId(null)}
        />
      )}
    </div>
  )
}
