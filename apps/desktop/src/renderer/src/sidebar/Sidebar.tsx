import type { ChatSummary } from "@ultra/shared"
import { useState } from "react"

import { switchActiveProject } from "../projects/project-workflows.js"
import { useAppStore } from "../state/app-store.js"
import { ChatContextMenu, type ContextMenuState } from "./ChatContextMenu.js"
import { ChatRow } from "./ChatRow.js"
import {
  archiveChat,
  createChat,
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

  const activeChatId = activeProjectId
    ? (layout.byProjectId[activeProjectId]?.activeChatId ?? null)
    : null

  const activeProject = activeProjectId
    ? (projects.byId[activeProjectId] ?? null)
    : null
  const activeChats = activeProjectId
    ? [...(sidebar.chatsByProjectId[activeProjectId] ?? [])].sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return b.updatedAt.localeCompare(a.updatedAt)
      })
    : []

  function handleSelectProject(projectId: string) {
    if (projectId === activeProjectId) {
      return
    }

    void switchActiveProject(projectId, actions, capabilities)
  }

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

  return (
    <div className="sidebar">
      <div className="sidebar__body">
        <p className="sidebar__section-label">Projects</p>
        {projects.allIds.map((projectId) => {
          const project = projects.byId[projectId]
          if (!project) return null
          const isActive = projectId === activeProjectId

          return (
            <button
              key={projectId}
              className={`sidebar__project-button ${isActive ? "sidebar__project-button--active" : ""}`}
              type="button"
              onClick={() => handleSelectProject(projectId)}
            >
              <span className="sidebar__project-name">{project.name}</span>
              <span className="sidebar__project-path">{project.rootPath}</span>
            </button>
          )
        })}

        <div className="sidebar__chats-panel">
          <div className="sidebar__chats-header">
            <div>
              <p className="sidebar__section-label">Chats</p>
              <p className="sidebar__chats-title">
                {activeProject ? activeProject.name : "No active project"}
              </p>
            </div>
            {activeProject ? (
              <button
                className="sidebar__new-chat"
                type="button"
                onClick={() => handleNewChat(activeProject.id)}
              >
                New Chat
              </button>
            ) : null}
          </div>

          {!activeProjectId ? (
            <p className="sidebar__status-copy">
              Open a project to load its chats.
            </p>
          ) : sidebar.chatsFetchStatus[activeProjectId] === "loading" ? (
            <p className="sidebar__status-copy">Loading chats…</p>
          ) : sidebar.chatsFetchStatus[activeProjectId] === "error" ? (
            <p className="sidebar__status-copy">
              Failed to load chats for this project.
            </p>
          ) : activeChats.length === 0 ? (
            <p className="sidebar__status-copy">No chats yet</p>
          ) : (
            <div className="sidebar__chat-list">
              {activeChats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeChatId}
                  onSelect={() => handleSelectChat(chat.id, chat.projectId)}
                  onContextMenu={(event) => handleChatContextMenu(event, chat)}
                />
              ))}
            </div>
          )}
        </div>
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
