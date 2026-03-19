import type {
  ChatTurnEventSnapshot,
  ChatTurnSnapshot,
  TerminalSessionSnapshot,
} from "@ultra/shared"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import {
  fetchChatMessages,
  fetchChatTurn,
  fetchChatTurns,
  replayChatTurnEvents,
  selectCurrentTurn,
  startChatTurn,
  subscribeToChatMessages,
  subscribeToChatTurnEvents,
} from "../chats/chat-message-workflows.js"
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

function formatTurnStatusLabel(
  status: ChatTurnSnapshot["status"] | "idle",
): string {
  switch (status) {
    case "queued":
      return "Queued"
    case "running":
      return "Running"
    case "succeeded":
      return "Completed"
    case "failed":
      return "Failed"
    case "canceled":
      return "Canceled"
    default:
      return "Idle"
  }
}

function summarizeTurnActivity(event: ChatTurnEventSnapshot | null): string {
  if (!event) {
    return "No turn events yet."
  }

  const stage =
    typeof event.payload.stage === "string" ? ` (${event.payload.stage})` : ""
  return `${event.eventType}${stage} · #${event.sequenceNumber}`
}

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
  onOpenSettings,
}: {
  onOpenProject: () => void
  onOpenSettings: () => void
}) {
  const activeProjectId = useAppStore((state) => state.app.activeProjectId)
  const connectionStatus = useAppStore((state) => state.app.connectionStatus)
  const capabilities = useAppStore((state) => state.app.capabilities)
  const terminal = useAppStore((state) => state.terminal)
  const sidebar = useAppStore((state) => state.sidebar)
  const layout = useAppStore((state) => state.layout)
  const chatMessages = useAppStore((state) => state.chatMessages)
  const chatTurns = useAppStore((state) => state.chatTurns)
  const actions = useAppStore((state) => state.actions)
  const threads = useAppStore((state) => state.threads)

  const chatFrameRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const turnSequenceRef = useRef<Record<string, number>>({})
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT)
  const [isDragging, setIsDragging] = useState(false)
  const [chatInput, setChatInput] = useState("")

  const activeChatId = activeProjectId
    ? (layout.byProjectId[activeProjectId]?.activeChatId ?? null)
    : null
  const activeChat =
    activeProjectId && activeChatId
      ? ((sidebar.chatsByProjectId[activeProjectId] ?? []).find(
          (chat) => chat.id === activeChatId,
        ) ?? null)
      : null
  const activeChatMessages = activeChatId
    ? (chatMessages.messagesByChatId[activeChatId] ?? [])
    : []
  const chatMessagesFetchStatus = activeChatId
    ? (chatMessages.fetchStatusByChatId[activeChatId] ?? "idle")
    : "idle"
  const turnsForActiveChat = activeChatId
    ? (chatTurns.turnsByChatId[activeChatId] ?? [])
    : []
  const chatTurnsFetchStatus = activeChatId
    ? (chatTurns.fetchStatusByChatId[activeChatId] ?? "idle")
    : "idle"
  const activeTurnId = activeChatId
    ? (chatTurns.activeTurnIdByChatId[activeChatId] ?? null)
    : null
  const activeTurn = activeTurnId
    ? (turnsForActiveChat.find((turn) => turn.turnId === activeTurnId) ?? null)
    : null
  const activeTurnEvents = activeTurnId
    ? (chatTurns.eventsByTurnId[activeTurnId] ?? [])
    : []
  const chatTurnSendStatus = activeChatId
    ? (chatTurns.sendStatusByChatId[activeChatId] ?? "idle")
    : "idle"
  const chatTurnSendError = activeChatId
    ? (chatTurns.sendErrorByChatId[activeChatId] ?? null)
    : null
  const latestTurnEvent = activeTurnEvents[activeTurnEvents.length - 1] ?? null
  const inFlightTurn =
    activeTurn?.status === "queued" || activeTurn?.status === "running"
  const chatInputDisabled =
    !activeChatId ||
    connectionStatus !== "connected" ||
    chatTurnSendStatus === "starting" ||
    inFlightTurn
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

  const projectLayout = activeProjectId
    ? layout.byProjectId[activeProjectId]
    : null
  const sidebarCollapsed = projectLayout?.sidebarCollapsed ?? false
  const splitRatio = projectLayout?.chatThreadSplitRatio ?? 0.55

  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const SIDEBAR_WIDTH = 280
  const MIN_PANE_WIDTH = 200
  const DRAG_HANDLE_WIDTH = 5

  const sidebarW = sidebarCollapsed ? 0 : SIDEBAR_WIDTH
  const availableWidth = containerWidth - sidebarW - DRAG_HANDLE_WIDTH
  const chatWidth = Math.max(
    MIN_PANE_WIDTH,
    Math.round(availableWidth * splitRatio),
  )
  const threadWidth = Math.max(MIN_PANE_WIDTH, availableWidth - chatWidth)

  const gridStyle: React.CSSProperties =
    containerWidth > 0
      ? {
          gridTemplateColumns: `${sidebarW}px ${chatWidth}px ${DRAG_HANDLE_WIDTH}px ${threadWidth}px`,
        }
      : {}

  function handleDragStart(e: React.PointerEvent) {
    e.preventDefault()
    const el = gridRef.current
    if (!el) return
    setIsDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handleDragMove(e: React.PointerEvent) {
    if (!isDragging || !gridRef.current || !activeProjectId) return
    const rect = gridRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - sidebarW
    const available = rect.width - sidebarW - DRAG_HANDLE_WIDTH
    if (available <= 0) return
    const ratio = Math.max(
      MIN_PANE_WIDTH / available,
      Math.min((available - MIN_PANE_WIDTH) / available, x / available),
    )
    actions.setLayoutField(activeProjectId, { chatThreadSplitRatio: ratio })
  }

  function handleDragEnd() {
    setIsDragging(false)
  }

  function handleResize(height: number) {
    const maxHeight = chatFrameRef.current
      ? chatFrameRef.current.clientHeight * MAX_DRAWER_HEIGHT_RATIO
      : 600
    setDrawerHeight(Math.min(Math.max(height, MIN_DRAWER_HEIGHT), maxHeight))
  }

  const recordTurnSequence = useCallback((events: ChatTurnEventSnapshot[]) => {
    const latest = events[events.length - 1]

    if (!latest) {
      return
    }

    turnSequenceRef.current[latest.turnId] = Math.max(
      turnSequenceRef.current[latest.turnId] ?? 0,
      latest.sequenceNumber,
    )
  }, [])

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

  useEffect(() => {
    setChatInput("")
    if (!activeChatId) {
      turnSequenceRef.current = {}
    }
  }, [activeChatId])

  useEffect(() => {
    if (!activeChatId || connectionStatus !== "connected") {
      return
    }
    const chatId: string = activeChatId

    let cancelled = false
    let unsubscribeChatMessages: (() => Promise<void>) | null = null
    let unsubscribeTurnEvents: (() => Promise<void>) | null = null

    const handleTurnEvent = (event: ChatTurnEventSnapshot) => {
      if (cancelled) {
        return
      }

      turnSequenceRef.current[event.turnId] = Math.max(
        turnSequenceRef.current[event.turnId] ?? 0,
        event.sequenceNumber,
      )

      if (
        event.eventType === "chat.turn_queued" ||
        event.eventType === "chat.turn_started"
      ) {
        actions.setActiveChatTurn(chatId, event.turnId)
      }

      fetchChatTurn(chatId, event.turnId, actions).catch((err) => {
        console.error("[chat] failed to refresh turn snapshot:", err)
      })
    }

    async function hydrateActiveChat() {
      try {
        await fetchChatMessages(chatId, actions)
        const turnsResult = await fetchChatTurns(chatId, actions)
        const currentTurn = selectCurrentTurn(turnsResult.turns)

        actions.setActiveChatTurn(chatId, currentTurn?.turnId ?? null)

        if (capabilities?.supportsSubscriptions) {
          unsubscribeChatMessages = await subscribeToChatMessages(
            chatId,
            actions,
          )
          unsubscribeTurnEvents = await subscribeToChatTurnEvents(
            { chatId },
            actions,
            handleTurnEvent,
          )
        }

        if (!currentTurn) {
          return
        }

        const replayResult = await replayChatTurnEvents(
          chatId,
          currentTurn.turnId,
          actions,
          turnSequenceRef.current[currentTurn.turnId],
        )
        recordTurnSequence(replayResult.events)
        await fetchChatTurn(chatId, currentTurn.turnId, actions)
      } catch (err) {
        if (!cancelled) {
          console.error("[chat] failed to hydrate active chat:", err)
        }
      }
    }

    void hydrateActiveChat()

    return () => {
      cancelled = true
      void unsubscribeChatMessages?.()
      void unsubscribeTurnEvents?.()
    }
  }, [
    activeChatId,
    actions,
    capabilities?.supportsSubscriptions,
    connectionStatus,
    recordTurnSequence,
  ])

  function handleStartTurn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!activeChatId) {
      return
    }

    const prompt = chatInput.trim()
    if (!prompt || chatInputDisabled) {
      return
    }

    startChatTurn(activeChatId, prompt, actions)
      .then(async ({ turn }) => {
        setChatInput("")

        const replayResult = await replayChatTurnEvents(
          activeChatId,
          turn.turnId,
          actions,
          turnSequenceRef.current[turn.turnId],
        )
        recordTurnSequence(replayResult.events)
        await fetchChatTurn(activeChatId, turn.turnId, actions)
      })
      .catch((err) => {
        console.error("[chat] failed to start turn:", err)
      })
  }

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
        ref={gridRef}
        style={gridStyle}
      >
        <aside
          className={`chat-frame__rail ${sidebarCollapsed ? "chat-frame__rail--collapsed" : ""}`}
        >
          <Sidebar
            onOpenProject={onOpenProject}
            onOpenSettings={onOpenSettings}
          />
        </aside>

        <section className="chat-frame__main">
          <div className="surface__header">
            <p className="surface__eyebrow">Active Chat</p>
            <h2 className="surface__title">
              {activeChat ? activeChat.title : "Command center"}
            </h2>
          </div>
          {activeChat ? (
            <section className="active-chat-pane" aria-label="Active chat pane">
              <div className="active-chat-pane__body">
                <section
                  className="active-chat-pane__transcript"
                  aria-label="Chat transcript"
                >
                  <div className="active-chat-pane__section-header">
                    <h3 className="active-chat-pane__section-title">
                      Transcript
                    </h3>
                    <div className="active-chat-pane__meta-row">
                      <span className="active-chat-pane__meta">
                        {activeChat.provider} · {activeChat.model}
                      </span>
                      <span
                        className="active-chat-pane__turn-status"
                        data-status={activeTurn?.status ?? "idle"}
                      >
                        {formatTurnStatusLabel(activeTurn?.status ?? "idle")}
                      </span>
                    </div>
                  </div>
                  <div className="active-chat-pane__transcript-scroll">
                    {chatMessagesFetchStatus === "loading" &&
                    activeChatMessages.length === 0 ? (
                      <p className="active-chat-pane__empty-copy">
                        Loading transcript…
                      </p>
                    ) : null}
                    {chatMessagesFetchStatus === "error" ? (
                      <p className="active-chat-pane__empty-copy active-chat-pane__empty-copy--error">
                        Failed to load transcript.
                      </p>
                    ) : null}
                    {chatMessagesFetchStatus !== "loading" &&
                    activeChatMessages.length === 0 ? (
                      <p className="active-chat-pane__empty-copy">
                        No messages yet. Send a prompt to start a turn.
                      </p>
                    ) : null}
                    {activeChatMessages.map((message) => (
                      <article
                        key={message.id}
                        className={`active-chat-pane__message active-chat-pane__message--${message.role}`}
                      >
                        <span className="active-chat-pane__message-role">
                          {message.role}
                        </span>
                        <p className="active-chat-pane__message-text">
                          {message.contentMarkdown ??
                            message.structuredPayloadJson ??
                            "No text content."}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>

                <aside
                  className="active-chat-pane__references"
                  aria-label="Chat references"
                >
                  <div className="active-chat-pane__section-header">
                    <h3 className="active-chat-pane__section-title">
                      References
                    </h3>
                  </div>
                  <dl className="active-chat-pane__reference-list">
                    <div className="active-chat-pane__reference-item">
                      <dt>Chat ID</dt>
                      <dd>{activeChat.id}</dd>
                    </div>
                    <div className="active-chat-pane__reference-item">
                      <dt>Status</dt>
                      <dd>{activeChat.status}</dd>
                    </div>
                    <div className="active-chat-pane__reference-item">
                      <dt>Turn ID</dt>
                      <dd>{activeTurn?.turnId ?? "—"}</dd>
                    </div>
                    <div className="active-chat-pane__reference-item">
                      <dt>Turn State</dt>
                      <dd>
                        {formatTurnStatusLabel(activeTurn?.status ?? "idle")}
                      </dd>
                    </div>
                    <div className="active-chat-pane__reference-item">
                      <dt>Turn Events</dt>
                      <dd>{activeTurnEvents.length}</dd>
                    </div>
                    <div className="active-chat-pane__reference-item">
                      <dt>Latest Activity</dt>
                      <dd>{summarizeTurnActivity(latestTurnEvent)}</dd>
                    </div>
                    <div className="active-chat-pane__reference-item">
                      <dt>Updated</dt>
                      <dd>{activeChat.updatedAt}</dd>
                    </div>
                  </dl>
                </aside>
              </div>

              <form
                className="active-chat-pane__input-dock"
                onSubmit={handleStartTurn}
              >
                <label
                  className="active-chat-pane__input-label"
                  htmlFor="chat-input"
                >
                  Message
                </label>
                <div className="active-chat-pane__input-row">
                  <textarea
                    id="chat-input"
                    className="active-chat-pane__input"
                    rows={3}
                    placeholder={
                      inFlightTurn
                        ? "Wait for the active turn to finish."
                        : "Send a prompt to start a chat turn."
                    }
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    disabled={chatInputDisabled}
                  />
                  <button
                    className="active-chat-pane__send"
                    type="submit"
                    disabled={
                      chatInputDisabled || chatInput.trim().length === 0
                    }
                  >
                    {chatTurnSendStatus === "starting"
                      ? "Starting…"
                      : inFlightTurn
                        ? "Running…"
                        : "Send"}
                  </button>
                </div>
                {chatTurnsFetchStatus === "error" ? (
                  <p className="active-chat-pane__input-hint active-chat-pane__input-hint--error">
                    Failed to load turn state for this chat.
                  </p>
                ) : null}
                {chatTurnSendError ? (
                  <p className="active-chat-pane__input-hint active-chat-pane__input-hint--error">
                    {chatTurnSendError}
                  </p>
                ) : null}
                {connectionStatus !== "connected" ? (
                  <p className="active-chat-pane__input-hint">
                    Reconnect to the backend before sending a new turn.
                  </p>
                ) : null}
              </form>
            </section>
          ) : (
            <section
              className="active-chat-pane active-chat-pane--empty"
              aria-label="No chat selected"
            >
              <strong>Select or create a chat to anchor the workspace</strong>
              <p>
                The active pane exposes transcript, references, and input dock
                once a chat is selected.
              </p>
            </section>
          )}
        </section>

        <div
          className={`chat-frame__drag-handle ${isDragging ? "chat-frame__drag-handle--active" : ""}`}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        />

        <div className="chat-frame__side">
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
