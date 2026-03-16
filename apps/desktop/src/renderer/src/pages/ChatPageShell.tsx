import type {
  SandboxContextSnapshot,
  SavedCommandSnapshot,
  TerminalRuntimeProfileResult,
  TerminalSessionSnapshot,
} from "@ultra/shared"
import { useEffect, useRef, useState } from "react"

import {
  runSavedCommandForProject,
  switchActiveSandbox,
} from "../projects/project-workflows.js"
import { Sidebar } from "../sidebar/Sidebar.js"
import { useAppStore } from "../state/app-store.js"

function formatRuntimeStatus(
  runtimeProfile: TerminalRuntimeProfileResult | null,
): string {
  if (!runtimeProfile) {
    return "unknown"
  }

  return runtimeProfile.sync.status.replace(/_/g, " ")
}

function formatSandboxLabel(sandbox: SandboxContextSnapshot | null): string {
  if (!sandbox) {
    return "No sandbox"
  }

  return sandbox.displayName
}

function SandboxSelector({
  sandboxes,
  activeSandboxId,
  onSelect,
}: {
  sandboxes: SandboxContextSnapshot[]
  activeSandboxId: string | null
  onSelect: (sandboxId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node

      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  const activeSandbox =
    sandboxes.find((sandbox) => sandbox.sandboxId === activeSandboxId) ?? null

  return (
    <div className="workspace-header__sandbox">
      <button
        ref={triggerRef}
        className="workspace-header__control workspace-header__control--selector"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="workspace-header__control-label">Sandbox</span>
        <span className="workspace-header__control-value">
          {formatSandboxLabel(activeSandbox)}
        </span>
      </button>

      {isOpen ? (
        <div ref={popoverRef} className="workspace-header__menu" role="menu">
          {sandboxes.map((sandbox) => {
            const isActive = sandbox.sandboxId === activeSandboxId

            return (
              <button
                key={sandbox.sandboxId}
                className={`workspace-header__menu-item ${isActive ? "workspace-header__menu-item--active" : ""}`}
                role="menuitemradio"
                aria-checked={isActive}
                type="button"
                onClick={() => {
                  onSelect(sandbox.sandboxId)
                  setIsOpen(false)
                }}
              >
                <span>{sandbox.displayName}</span>
                <small>{sandbox.path}</small>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function RuntimeSyncIndicator({
  runtimeProfile,
}: {
  runtimeProfile: TerminalRuntimeProfileResult | null
}) {
  const status = formatRuntimeStatus(runtimeProfile)

  return (
    <div
      className="workspace-header__status"
      data-status={runtimeProfile?.sync.status ?? "unknown"}
    >
      <span className="workspace-header__status-label">Runtime</span>
      <strong className="workspace-header__status-value">{status}</strong>
    </div>
  )
}

function TerminalDrawer({
  open,
  activeSandbox,
  runtimeProfile,
  sessions,
  focusedSessionId,
  savedCommands,
  onClose,
  onFocusSession,
  onRunSavedCommand,
}: {
  open: boolean
  activeSandbox: SandboxContextSnapshot | null
  runtimeProfile: TerminalRuntimeProfileResult | null
  sessions: TerminalSessionSnapshot[]
  focusedSessionId: string | null
  savedCommands: SavedCommandSnapshot[]
  onClose: () => void
  onFocusSession: (sessionId: string) => void
  onRunSavedCommand: (commandId: SavedCommandSnapshot["commandId"]) => void
}) {
  const focusedSession =
    sessions.find((session) => session.sessionId === focusedSessionId) ??
    sessions[0] ??
    null

  return (
    <section
      className={`terminal-drawer ${open ? "terminal-drawer--open" : "terminal-drawer--closed"}`}
    >
      <div className="terminal-drawer__header">
        <div>
          <p className="surface__eyebrow">Terminal</p>
          <h2 className="surface__title">
            {activeSandbox ? activeSandbox.displayName : "No active sandbox"}
          </h2>
        </div>
        <div className="terminal-drawer__meta">
          <RuntimeSyncIndicator runtimeProfile={runtimeProfile} />
          <button
            className="terminal-drawer__toggle"
            type="button"
            onClick={onClose}
          >
            {open ? "Hide Drawer" : "Show Drawer"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="terminal-drawer__body">
          <div className="terminal-drawer__commands">
            {savedCommands.length === 0 ? (
              <span className="terminal-drawer__empty-copy">
                No saved commands available
              </span>
            ) : (
              savedCommands.map((command) => (
                <button
                  key={command.commandId}
                  className="terminal-drawer__command"
                  type="button"
                  disabled={!command.isAvailable}
                  onClick={() => onRunSavedCommand(command.commandId)}
                >
                  {command.label}
                </button>
              ))
            )}
          </div>

          <div className="terminal-drawer__sessions">
            <div className="terminal-drawer__tabs" role="tablist">
              {sessions.length === 0 ? (
                <span className="terminal-drawer__empty-copy">
                  No terminal sessions yet
                </span>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.sessionId}
                    className={`terminal-drawer__tab ${session.sessionId === focusedSession?.sessionId ? "terminal-drawer__tab--active" : ""}`}
                    type="button"
                    onClick={() => onFocusSession(session.sessionId)}
                  >
                    <span>{session.title}</span>
                    <small>{session.status}</small>
                  </button>
                ))
              )}
            </div>

            <div className="terminal-drawer__panel">
              {focusedSession ? (
                <>
                  <div className="terminal-drawer__session-meta">
                    <strong>
                      {focusedSession.commandLabel ?? focusedSession.title}
                    </strong>
                    <span>{focusedSession.commandLine}</span>
                  </div>
                  <pre className="terminal-drawer__output">
                    {focusedSession.recentOutput ||
                      "Session output will appear here once activity is available."}
                  </pre>
                </>
              ) : (
                <div className="terminal-drawer__empty-state">
                  <strong>Ready to test in the active sandbox</strong>
                  <p>
                    Use a saved command or the upcoming Open Terminal flow to
                    start a session in this project context.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
  const projectSandboxes = activeProjectId
    ? (sandboxes.idsByProjectId[activeProjectId] ?? [])
        .map((sandboxId) => sandboxes.byId[sandboxId])
        .filter((sandbox): sandbox is SandboxContextSnapshot =>
          Boolean(sandbox),
        )
    : []
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

  function handleSelectSandbox(sandboxId: string) {
    if (!activeProjectId) {
      return
    }

    void switchActiveSandbox(activeProjectId, sandboxId, actions)
  }

  function handleRunSavedCommand(commandId: SavedCommandSnapshot["commandId"]) {
    if (!activeProjectId) {
      return
    }

    void runSavedCommandForProject(activeProjectId, commandId, actions)
  }

  return (
    <section className="chat-workspace" data-page="chat">
      <header className="workspace-header">
        <div className="workspace-header__identity">
          <p className="surface__eyebrow">Project</p>
          <h1 className="workspace-header__title">
            {activeProject ? activeProject.name : "Open a project"}
          </h1>
          <p className="workspace-header__path">
            {activeProject?.rootPath ??
              "Choose a project to enter the chat-first workspace."}
          </p>
        </div>

        <div className="workspace-header__controls">
          <SandboxSelector
            sandboxes={projectSandboxes}
            activeSandboxId={activeSandboxId}
            onSelect={handleSelectSandbox}
          />
          <RuntimeSyncIndicator runtimeProfile={runtimeProfile} />
          <button
            className="workspace-header__button"
            type="button"
            disabled={!activeProjectId}
            onClick={() => {
              if (activeProjectId) {
                actions.setTerminalDrawerOpen(activeProjectId, true)
              }
            }}
          >
            Open Terminal
          </button>
          <button
            className="workspace-header__button workspace-header__button--ghost"
            type="button"
            onClick={() => actions.setSystemToolsOpen(true)}
          >
            System &amp; Tools
          </button>
        </div>
      </header>

      <div className="chat-workspace__body">
        <aside className="chat-workspace__sidebar">
          <Sidebar onOpenProject={onOpenProject} />
        </aside>

        <section className="chat-workspace__main">
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

        <aside className="chat-workspace__thread-pane">
          <section className="chat-workspace__thread-surface">
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
        </aside>
      </div>

      <TerminalDrawer
        open={drawerOpen}
        activeSandbox={activeSandbox}
        runtimeProfile={runtimeProfile}
        sessions={terminalSessions}
        focusedSessionId={focusedSessionId}
        savedCommands={savedCommands}
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
      />
    </section>
  )
}
