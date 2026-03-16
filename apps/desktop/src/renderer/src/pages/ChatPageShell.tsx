import type { TerminalSessionSnapshot } from "@ultra/shared"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Sidebar } from "../sidebar/Sidebar.js"
import { useAppStore } from "../state/app-store.js"
import { TerminalPane } from "../terminal/TerminalPane.js"
import { TerminalTabContextMenu } from "../terminal/TerminalTabContextMenu.js"
import {
  closeTerminalSession,
  openTerminal,
  pinTerminalSession,
  renameTerminalSession,
  resizeTerminalSession,
  writeTerminalInput,
} from "../terminal/terminal-workflows.js"
import { ThreadPane } from "../threads/ThreadPane.js"
import {
  fetchThreadMessages,
  fetchThreads,
  sendThreadMessage,
} from "../threads/thread-workflows.js"

const DEFAULT_DRAWER_HEIGHT = 200
const MIN_DRAWER_HEIGHT = 100
const MAX_DRAWER_HEIGHT_RATIO = 0.8

function TerminalDrawer({
  height,
  sessions,
  focusedSessionId,
  onResize,
  onClose,
  onFocusSession,
  onTerminalInput,
  onTerminalResize,
  onNewSession,
  onCloseSession,
  onRenameSession,
  onPinSession,
}: {
  height: number
  sessions: TerminalSessionSnapshot[]
  focusedSessionId: string | null
  onResize: (height: number) => void
  onClose: () => void
  onFocusSession: (sessionId: string) => void
  onTerminalInput: (sessionId: string, data: string) => void
  onTerminalResize: (sessionId: string, cols: number, rows: number) => void
  onNewSession: () => void
  onCloseSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, displayName: string | null) => void
  onPinSession: (sessionId: string, pinned: boolean) => void
}) {
  const focusedSession =
    sessions.find((session) => session.sessionId === focusedSessionId) ??
    sessions[0] ??
    null

  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingTabId])

  const contextMenuSession = contextMenu
    ? (sessions.find((s) => s.sessionId === contextMenu.sessionId) ?? null)
    : null

  function getTabName(session: TerminalSessionSnapshot) {
    return session.displayName ?? session.title
  }

  function startRename(sessionId: string) {
    const session = sessions.find((s) => s.sessionId === sessionId)
    if (!session) return
    setEditingTabId(sessionId)
    setEditValue(getTabName(session))
  }

  function commitRename() {
    if (!editingTabId) return
    const session = sessions.find((s) => s.sessionId === editingTabId)
    if (!session) {
      setEditingTabId(null)
      return
    }
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== session.title) {
      onRenameSession(editingTabId, trimmed)
    } else {
      onRenameSession(editingTabId, null)
    }
    setEditingTabId(null)
  }

  function cancelRename() {
    setEditingTabId(null)
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = startY - moveEvent.clientY
      const newHeight = Math.max(MIN_DRAWER_HEIGHT, startHeight + delta)
      onResize(newHeight)
    }

    function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
    }

    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
  }

  return (
    <div className="terminal-drawer" style={{ height: `${height}px` }}>
      <div
        className="terminal-drawer__drag-handle"
        onPointerDown={handlePointerDown}
      />
      <div className="terminal-drawer__header">
        <span className="terminal-drawer__title">Terminal</span>
        <div className="terminal-drawer__header-actions">
          <button
            className="terminal-drawer__close"
            type="button"
            onClick={onClose}
            aria-label="Close terminal"
          >
            ×
          </button>
        </div>
      </div>
      <div className="terminal-drawer__content">
        <div className="terminal-drawer__tabs" role="tablist">
          {sessions.map((session) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: context menu on tab wrapper
            <div
              key={session.sessionId}
              className={`terminal-drawer__tab ${session.sessionId === focusedSession?.sessionId ? "terminal-drawer__tab--active" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({
                  sessionId: session.sessionId,
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
            >
              {editingTabId === session.sessionId ? (
                <input
                  ref={editInputRef}
                  className="terminal-drawer__tab-edit"
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename()
                    if (e.key === "Escape") cancelRename()
                  }}
                />
              ) : (
                <button
                  className="terminal-drawer__tab-label"
                  type="button"
                  role="tab"
                  aria-selected={
                    session.sessionId === focusedSession?.sessionId
                  }
                  onClick={() => onFocusSession(session.sessionId)}
                  onDoubleClick={() => startRename(session.sessionId)}
                >
                  {session.pinned && (
                    <span
                      className="terminal-drawer__tab-pin"
                      aria-hidden="true"
                    />
                  )}
                  {getTabName(session)}
                </button>
              )}
              <button
                className="terminal-drawer__tab-close"
                type="button"
                aria-label={`Close ${getTabName(session)}`}
                onClick={() => onCloseSession(session.sessionId)}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="terminal-drawer__tab-new"
            type="button"
            onClick={onNewSession}
            aria-label="New terminal session"
          >
            +
          </button>
        </div>
        <div className="terminal-drawer__panel">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <div
                key={session.sessionId}
                className={`terminal-drawer__pane-wrapper ${
                  session.sessionId === focusedSession?.sessionId
                    ? "terminal-drawer__pane-wrapper--visible"
                    : "terminal-drawer__pane-wrapper--hidden"
                }`}
              >
                <TerminalPane
                  sessionId={session.sessionId}
                  projectId={session.projectId}
                  recentOutput={session.recentOutput}
                  onInput={onTerminalInput}
                  onResize={onTerminalResize}
                />
              </div>
            ))
          ) : (
            <p className="terminal-drawer__placeholder">
              Terminal sessions will appear here
            </p>
          )}
        </div>
      </div>
      {contextMenu &&
        contextMenuSession &&
        createPortal(
          <TerminalTabContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            pinned={contextMenuSession.pinned}
            onRename={() => startRename(contextMenu.sessionId)}
            onTogglePin={() =>
              onPinSession(contextMenu.sessionId, !contextMenuSession.pinned)
            }
            onClose={() => onCloseSession(contextMenu.sessionId)}
            onDismiss={() => setContextMenu(null)}
          />,
          document.body,
        )}
    </div>
  )
}

export function ChatPageShell({
  onOpenProject,
}: {
  onOpenProject: () => void
}) {
  const activeProjectId = useAppStore((state) => state.app.activeProjectId)
  const terminal = useAppStore((state) => state.terminal)
  const sidebar = useAppStore((state) => state.sidebar)
  const layout = useAppStore((state) => state.layout)
  const actions = useAppStore((state) => state.actions)
  const threads = useAppStore((state) => state.threads)

  const chatFrameRef = useRef<HTMLDivElement>(null)
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT)

  const activeChatId = activeProjectId
    ? (layout.byProjectId[activeProjectId]?.activeChatId ?? null)
    : null
  const activeChat =
    activeProjectId && activeChatId
      ? ((sidebar.chatsByProjectId[activeProjectId] ?? []).find(
          (chat) => chat.id === activeChatId,
        ) ?? null)
      : null
  const terminalSessions = activeProjectId
    ? (terminal.sessionsByProjectId[activeProjectId] ?? [])
        .filter((s) => s.status === "running")
        .slice()
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          return 0
        })
    : []
  const focusedSessionId = activeProjectId
    ? (terminal.focusedSessionIdByProjectId[activeProjectId] ?? null)
    : null
  const drawerOpen = activeProjectId
    ? (terminal.drawerOpenByProjectId[activeProjectId] ?? false)
    : false

  const projectThreads = activeProjectId
    ? (threads.threadsByProjectId[activeProjectId] ?? [])
    : []
  const selectedThreadId = activeProjectId
    ? (layout.byProjectId[activeProjectId]?.selectedThreadId ?? null)
    : null
  const threadFetchStatus = activeProjectId
    ? (threads.threadFetchStatus[activeProjectId] ?? "idle")
    : "idle"

  function handleResize(height: number) {
    const maxHeight = chatFrameRef.current
      ? chatFrameRef.current.clientHeight * MAX_DRAWER_HEIGHT_RATIO
      : 600
    setDrawerHeight(Math.min(Math.max(height, MIN_DRAWER_HEIGHT), maxHeight))
  }

  function handleNewTerminalSession() {
    if (!activeProjectId) return
    openTerminal(activeProjectId, actions, undefined, { forceNew: true }).catch(
      (err) => {
        console.error("[terminal] failed to open new session:", err)
      },
    )
  }

  function handleCloseSession(sessionId: string) {
    if (!activeProjectId) return
    closeTerminalSession(activeProjectId, sessionId, actions).catch((err) => {
      console.error("[terminal] failed to close session:", err)
    })
  }

  function handleTerminalInput(sessionId: string, data: string) {
    if (!activeProjectId) return
    void writeTerminalInput(activeProjectId, sessionId, data)
  }

  function handleTerminalResize(sessionId: string, cols: number, rows: number) {
    if (!activeProjectId) return
    void resizeTerminalSession(activeProjectId, sessionId, cols, rows)
  }

  function handleRenameSession(sessionId: string, displayName: string | null) {
    if (!activeProjectId) return
    renameTerminalSession(
      activeProjectId,
      sessionId,
      displayName,
      actions,
    ).catch((err) => {
      console.error("[terminal] failed to rename session:", err)
    })
  }

  function handlePinSession(sessionId: string, pinned: boolean) {
    if (!activeProjectId) return
    pinTerminalSession(activeProjectId, sessionId, pinned, actions).catch(
      (err) => {
        console.error("[terminal] failed to pin session:", err)
      },
    )
  }

  useEffect(() => {
    if (!activeProjectId) return
    fetchThreads(activeProjectId, actions).catch((err) => {
      console.error("[threads] failed to fetch:", err)
    })
  }, [activeProjectId, actions])

  function handleSelectThread(threadId: string | null) {
    if (!activeProjectId) return
    actions.setLayoutField(activeProjectId, { selectedThreadId: threadId })
  }

  function handleFetchMessages(threadId: string) {
    fetchThreadMessages(threadId, actions).catch((err) => {
      console.error("[threads] failed to fetch messages:", err)
    })
  }

  function handleSendMessage(threadId: string, content: string) {
    sendThreadMessage(threadId, content, actions).catch((err) => {
      console.error("[threads] failed to send message:", err)
    })
  }

  return (
    <div className="chat-frame" ref={chatFrameRef} data-page="chat">
      <div
        className={`chat-frame__grid ${drawerOpen ? "chat-frame__grid--drawer-open" : ""}`}
      >
        <aside className="chat-frame__rail">
          <Sidebar onOpenProject={onOpenProject} />
        </aside>

        <section className="chat-frame__main">
          <div className="surface__header">
            <p className="surface__eyebrow">Active Chat</p>
            <h2 className="surface__title">
              {activeChat ? activeChat.title : "Command center"}
            </h2>
          </div>
          <div className="placeholder-card placeholder-card--tall">
            <strong>
              {activeChat
                ? "Chat transcript and approval controls land here"
                : "Select or create a chat to anchor the workspace"}
            </strong>
            <p>
              The center pane stays focused on the planning conversation while
              the right pane tracks execution and the drawer handles testing.
            </p>
          </div>
        </section>

        <div className="chat-frame__side">
          <section className="chat-frame__side-top">
            <div className="surface__header">
              <p className="surface__eyebrow">Threads</p>
              <h2 className="surface__title">Execution pane</h2>
            </div>
            <ThreadPane
              threads={projectThreads}
              selectedThreadId={selectedThreadId}
              messagesByThreadId={threads.messagesByThreadId}
              fetchStatus={threadFetchStatus}
              onSelectThread={handleSelectThread}
              onFetchMessages={handleFetchMessages}
              onSendMessage={handleSendMessage}
            />
          </section>
          <section className="chat-frame__side-bottom">
            <div className="surface__header">
              <p className="surface__eyebrow">Status</p>
              <h2 className="surface__title">Runtime summary</h2>
            </div>
            <div className="placeholder-card">
              <strong>Runtime health stays visible</strong>
              <p>
                This region will hold coordinator, watchdog, and approval state
                without turning the page into an ops console.
              </p>
            </div>
          </section>
        </div>

        {drawerOpen && (
          <TerminalDrawer
            height={drawerHeight}
            sessions={terminalSessions}
            focusedSessionId={focusedSessionId}
            onResize={handleResize}
            onClose={() => {
              if (activeProjectId) {
                actions.setTerminalDrawerOpen(activeProjectId, false)
              }
            }}
            onFocusSession={(sessionId) => {
              if (activeProjectId) {
                actions.setFocusedTerminalSession(activeProjectId, sessionId)
              }
            }}
            onTerminalInput={handleTerminalInput}
            onTerminalResize={handleTerminalResize}
            onNewSession={handleNewTerminalSession}
            onCloseSession={handleCloseSession}
            onRenameSession={handleRenameSession}
            onPinSession={handlePinSession}
          />
        )}
      </div>
    </div>
  )
}
