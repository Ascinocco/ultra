import type { ChatSummary } from "@ultra/shared"
import { useState } from "react"

import { useAppStore } from "../state/app-store.js"
import {
  type ContextMenuState,
  ChatContextMenu,
} from "./ChatContextMenu.js"
import { ProjectGroup } from "./ProjectGroup.js"
import {
  archiveChat,
  createChat,
  loadChatsForProject,
  pinChat,
  renameChat,
  unpinChat,
} from "./chat-workflows.js"

export function Sidebar() {
  const projects = useAppStore((s) => s.projects)
  const sidebar = useAppStore((s) => s.sidebar)
  const activeProjectId = useAppStore((s) => s.app.activeProjectId)
  const layout = useAppStore((s) => s.layout)
  const actions = useAppStore((s) => s.actions)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  const activeChatId =
    activeProjectId
      ? (layout.byProjectId[activeProjectId]?.activeChatId ?? null)
      : null

  function handleToggleExpand(projectId: string) {
    const wasExpanded = sidebar.expandedProjectIds.includes(projectId)
    actions.toggleProjectExpanded(projectId)
    if (!wasExpanded && !sidebar.chatsByProjectId[projectId]) {
      void loadChatsForProject(projectId, actions)
    }
  }

  function handleSelectChat(chatId: string, projectId: string) {
    if (projectId !== activeProjectId) {
      actions.setActiveProjectId(projectId)
    }
    actions.setLayoutField(projectId, { activeChatId: chatId })
  }

  function handleNewChat() {
    if (!activeProjectId) return
    void createChat(activeProjectId, actions)
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

  return (
    <div className="sidebar">
      <div className="sidebar__header">
        <button
          className="sidebar__new-chat"
          type="button"
          disabled={!activeProjectId}
          onClick={handleNewChat}
        >
          <span aria-hidden="true">+</span> New Chat
        </button>
      </div>

      <div className="sidebar__body">
        <p className="sidebar__section-label">Projects</p>
        {projects.allIds.map((projectId) => {
          const project = projects.byId[projectId]
          if (!project) return null
          return (
            <ProjectGroup
              key={projectId}
              project={project}
              isExpanded={sidebar.expandedProjectIds.includes(projectId)}
              chats={sidebar.chatsByProjectId[projectId] ?? []}
              fetchStatus={sidebar.chatsFetchStatus[projectId]}
              activeChatId={projectId === activeProjectId ? activeChatId : null}
              onToggleExpand={() => handleToggleExpand(projectId)}
              onSelectChat={(chatId) => handleSelectChat(chatId, projectId)}
              onChatContextMenu={handleChatContextMenu}
              onRetryFetch={() => void loadChatsForProject(projectId, actions)}
            />
          )
        })}
      </div>

      <div className="sidebar__footer">
        <button className="sidebar__settings" type="button">
          Settings
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
