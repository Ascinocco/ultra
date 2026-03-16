import type { ChatSummary } from "@ultra/shared"
import { useEffect, useRef, useState } from "react"

import { switchActiveProject } from "../projects/project-workflows.js"
import { useAppStore } from "../state/app-store.js"
import { ChatContextMenu, type ContextMenuState } from "./ChatContextMenu.js"
import { ProjectGroup } from "./ProjectGroup.js"
import {
  archiveChat,
  createChat,
  loadChatsForProject,
  pinChat,
  renameChat,
  unpinChat,
} from "./chat-workflows.js"

export function Sidebar({ onOpenProject }: { onOpenProject: () => void }) {
  const projects = useAppStore((s) => s.projects)
  const sidebar = useAppStore((s) => s.sidebar)
  const activeProjectId = useAppStore((s) => s.app.activeProjectId)
  const capabilities = useAppStore((s) => s.app.capabilities)
  const layout = useAppStore((s) => s.layout)
  const actions = useAppStore((s) => s.actions)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
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
    void createChat(projectId, actions)
  }

  function handleChatContextMenu(event: React.MouseEvent, chat: ChatSummary) {
    event.preventDefault()
    setContextMenu({ chat, x: event.clientX, y: event.clientY })
  }

  // TODO: Replace window.prompt with a custom modal — prompt may be blocked in Electron.
  function handleRename(chat: ChatSummary) {
    const newTitle = window.prompt("Rename chat:", chat.title)
    if (newTitle && newTitle !== chat.title) {
      void renameChat(chat.id, newTitle, actions)
    }
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
        <p className="sidebar__section-label">Chats</p>

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
              />
            )
          })
        )}
      </div>

      <div className="sidebar__footer">
        <button className="sidebar__settings" type="button">
          Settings
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
    </div>
  )
}
