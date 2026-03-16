import type {
  SandboxContextSnapshot,
  SavedCommandSnapshot,
  TerminalRuntimeProfileResult,
  TerminalSessionSnapshot,
} from "@ultra/shared"
import { useRef, useState } from "react"

import {
  runSavedCommandForProject,
} from "../projects/project-workflows.js"
import { Sidebar } from "../sidebar/Sidebar.js"
import { useAppStore } from "../state/app-store.js"
import { TerminalPane } from "../terminal/TerminalPane.js"
import {
  closeTerminalSession,
  openTerminal,
  writeTerminalInput,
  resizeTerminalSession,
} from "../terminal/terminal-workflows.js"

const DEFAULT_DRAWER_HEIGHT = 200
const MIN_DRAWER_HEIGHT = 100
const MAX_DRAWER_HEIGHT_RATIO = 0.8

function formatRuntimeStatus(
  runtimeProfile: TerminalRuntimeProfileResult | null,
): string {
  if (!runtimeProfile) {
    return "unknown"
  }

  return runtimeProfile.sync.status.replace(/_/g, " ")
}

function TerminalDrawer({
  height,
  activeSandbox,
  runtimeProfile,
  sessions,
  focusedSessionId,
  savedCommands,
  onResize,
  onClose,
  onFocusSession,
  onRunSavedCommand,
  onTerminalInput,
  onTerminalResize,
  onNewSession,
  onCloseSession,
}: {
  height: number
  activeSandbox: SandboxContextSnapshot | null
  runtimeProfile: TerminalRuntimeProfileResult | null
  sessions: TerminalSessionSnapshot[]
  focusedSessionId: string | null
  savedCommands: SavedCommandSnapshot[]
  onResize: (height: number) => void
  onClose: () => void
  onFocusSession: (sessionId: string) => void
  onRunSavedCommand: (commandId: SavedCommandSnapshot["commandId"]) => void
  onTerminalInput: (sessionId: string, data: string) => void
  onTerminalResize: (sessionId: string, cols: number, rows: number) => void
  onNewSession: () => void
  onCloseSession: (sessionId: string) => void
}) {
  const focusedSession =
    sessions.find((session) => session.sessionId === focusedSessionId) ??
    sessions[0] ??
    null

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
        <span className="terminal-drawer__title">
          Terminal{activeSandbox ? ` · ${activeSandbox.displayName}` : ""}
        </span>
        <span
          className="terminal-drawer__sync-status"
          data-status={runtimeProfile?.sync.status ?? "unknown"}
        >
          {formatRuntimeStatus(runtimeProfile)}
        </span>
        <div className="terminal-drawer__header-actions">
          {savedCommands.map((command) => (
            <button
              key={command.commandId}
              className="terminal-drawer__command"
              type="button"
              disabled={!command.isAvailable}
              onClick={() => onRunSavedCommand(command.commandId)}
            >
              {command.label}
            </button>
          ))}
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
        {sessions.length > 0 && (
          <div className="terminal-drawer__tabs" role="tablist">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                className={`terminal-drawer__tab ${session.sessionId === focusedSession?.sessionId ? "terminal-drawer__tab--active" : ""}`}
                type="button"
                role="tab"
                aria-selected={
                  session.sessionId === focusedSession?.sessionId
                }
                onClick={() => onFocusSession(session.sessionId)}
              >
                {session.title}
                <small>{session.status}</small>
                <span
                  className="terminal-drawer__tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${session.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseSession(session.sessionId)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation()
                      onCloseSession(session.sessionId)
                    }
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            <button
              className="terminal-drawer__tab terminal-drawer__tab--new"
              type="button"
              onClick={onNewSession}
              aria-label="New terminal session"
            >
              +
            </button>
          </div>
        )}
        <div className="terminal-drawer__panel">
          {focusedSession ? (
            <TerminalPane
              key={focusedSession.sessionId}
              sessionId={focusedSession.sessionId}
              projectId={focusedSession.projectId}
              recentOutput={focusedSession.recentOutput}
              onInput={onTerminalInput}
              onResize={onTerminalResize}
            />
          ) : (
            <p className="terminal-drawer__placeholder">
              Terminal sessions will appear here
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChatPageShell({
  onOpenProject,
}: {
  onOpenProject: () => void
}) {
  const projects = useAppStore((state) => state.projects)
  const activeProjectId = useAppStore((state) => state.app.activeProjectId)
  const sandboxes = useAppStore((state) => state.sandboxes)
  const terminal = useAppStore((state) => state.terminal)
  const sidebar = useAppStore((state) => state.sidebar)
  const layout = useAppStore((state) => state.layout)
  const actions = useAppStore((state) => state.actions)

  const chatFrameRef = useRef<HTMLDivElement>(null)
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT)

  const activeProject = activeProjectId
    ? (projects.byId[activeProjectId] ?? null)
    : null
  const activeChatId = activeProjectId
    ? (layout.byProjectId[activeProjectId]?.activeChatId ?? null)
    : null
  const activeChat =
    activeProjectId && activeChatId
      ? ((sidebar.chatsByProjectId[activeProjectId] ?? []).find(
          (chat) => chat.id === activeChatId,
        ) ?? null)
      : null
  const activeSandboxId = activeProjectId
    ? (sandboxes.activeByProjectId[activeProjectId] ?? null)
    : null
  const activeSandbox = activeSandboxId
    ? (sandboxes.byId[activeSandboxId] ?? null)
    : null
  const runtimeProfile = activeProjectId
    ? (sandboxes.runtimeByProjectId[activeProjectId] ?? null)
    : null
  const terminalSessions = activeProjectId
    ? (terminal.sessionsByProjectId[activeProjectId] ?? [])
    : []
  const focusedSessionId = activeProjectId
    ? (terminal.focusedSessionIdByProjectId[activeProjectId] ?? null)
    : null
  const savedCommands = activeProjectId
    ? (terminal.savedCommandsByProjectId[activeProjectId] ?? [])
    : []
  const drawerOpen = activeProjectId
    ? (terminal.drawerOpenByProjectId[activeProjectId] ?? false)
    : false

  function handleResize(height: number) {
    const maxHeight = chatFrameRef.current
      ? chatFrameRef.current.clientHeight * MAX_DRAWER_HEIGHT_RATIO
      : 600
    setDrawerHeight(Math.min(Math.max(height, MIN_DRAWER_HEIGHT), maxHeight))
  }

  function handleRunSavedCommand(
    commandId: SavedCommandSnapshot["commandId"],
  ) {
    if (!activeProjectId) {
      return
    }

    void runSavedCommandForProject(activeProjectId, commandId, actions)
  }

  function handleOpenTerminal() {
    if (!activeProjectId) return
    void openTerminal(activeProjectId, actions)
  }

  function handleCloseSession(sessionId: string) {
    if (!activeProjectId) return
    void closeTerminalSession(activeProjectId, sessionId, actions)
  }

  function handleTerminalInput(sessionId: string, data: string) {
    if (!activeProjectId) return
    void writeTerminalInput(activeProjectId, sessionId, data)
  }

  function handleTerminalResize(sessionId: string, cols: number, rows: number) {
    if (!activeProjectId) return
    void resizeTerminalSession(activeProjectId, sessionId, cols, rows)
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
            <div className="placeholder-card">
              <strong>Thread list and detail stay in this pane</strong>
              <p>
                ULR-26 will replace this shell with thread cards, timeline
                detail, and review-aware context.
              </p>
            </div>
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
            activeSandbox={activeSandbox}
            runtimeProfile={runtimeProfile}
            sessions={terminalSessions}
            focusedSessionId={focusedSessionId}
            savedCommands={savedCommands}
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
            onRunSavedCommand={handleRunSavedCommand}
            onTerminalInput={handleTerminalInput}
            onTerminalResize={handleTerminalResize}
            onNewSession={handleOpenTerminal}
            onCloseSession={handleCloseSession}
          />
        )}
      </div>
    </div>
  )
}
