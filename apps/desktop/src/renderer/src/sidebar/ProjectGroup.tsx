import type { ChatSummary, ProjectSnapshot } from "@ultra/shared"

import { ChatRow } from "./ChatRow.js"

function sortChats(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function ProjectGroup({
  project,
  isExpanded,
  chats,
  fetchStatus,
  activeChatId,
  onToggleExpand,
  onSelectChat,
  onChatContextMenu,
  onRetryFetch,
  onNewChat,
  onOpenSettings,
  renamingChatId,
  renameDraft,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
}: {
  project: ProjectSnapshot
  isExpanded: boolean
  chats: ChatSummary[]
  fetchStatus: "idle" | "loading" | "error" | undefined
  activeChatId: string | null
  onToggleExpand: () => void
  onSelectChat: (chatId: string) => void
  onChatContextMenu: (event: React.MouseEvent, chat: ChatSummary) => void
  onRetryFetch: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  renamingChatId: string | null
  renameDraft: string
  onRenameDraftChange: (value: string) => void
  onRenameCommit: (chat: ChatSummary) => void
  onRenameCancel: () => void
}) {
  return (
    <div className="project-group">
      <div className="project-group__header">
        <button
          className="project-group__row"
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
        >
          <span className="project-group__chevron" aria-hidden="true">
            {isExpanded ? "\u25BE" : "\u25B8"}
          </span>
          <svg
            className="project-group__icon"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1.5 2.5h4.667L8 4.5h6.5v9h-13z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <span className="project-group__name">{project.name}</span>
        </button>
        <button
          className="project-group__settings"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpenSettings()
          }}
          aria-label={`Settings for ${project.name}`}
        >
          ⚙
        </button>
        <button
          className="project-group__new-chat"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onNewChat()
          }}
          aria-label={`New chat in ${project.name}`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 1v10M1 6h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {isExpanded ? (
        <div className="project-group__chats">
          {fetchStatus === "loading" ? (
            <p className="project-group__status">Loading…</p>
          ) : fetchStatus === "error" ? (
            <div className="project-group__status">
              <span>Failed to load chats</span>
              <button
                className="project-group__retry"
                type="button"
                onClick={onRetryFetch}
              >
                Retry
              </button>
            </div>
          ) : chats.length === 0 ? (
            <p className="project-group__status">No chats yet</p>
          ) : (
            sortChats(chats).map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                isActive={chat.id === activeChatId}
                onSelect={() => onSelectChat(chat.id)}
                onContextMenu={(e) => onChatContextMenu(e, chat)}
                isEditing={chat.id === renamingChatId}
                renameDraft={renameDraft}
                onRenameDraftChange={onRenameDraftChange}
                onRenameCommit={() => onRenameCommit(chat)}
                onRenameCancel={onRenameCancel}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
