import type { ChatMessageSnapshot, TerminalSessionSnapshot } from "@ultra/shared"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import {
  approvePlan as approveChatPlan,
  approveSpecs as approveChatSpecs,
  fetchChatMessages,
  sendChatMessage,
  startThreadFromChat,
  subscribeToChatMessages,
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

function resolveChatMessageVariant(
  message: ChatMessageSnapshot,
): "assistant" | "user" | "system" {
  if (message.role === "assistant") {
    return "assistant"
  }

  if (message.role === "user") {
    return "user"
  }

  return "system"
}

function findLatestChatMessageByType(
  messages: ChatMessageSnapshot[],
  messageType: string,
): {
  message: ChatMessageSnapshot
  index: number
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    if (message.messageType === messageType) {
      return { message, index }
    }
  }

  return null
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
  const capabilities = useAppStore((state) => state.app.capabilities)
  const terminal = useAppStore((state) => state.terminal)
  const sidebar = useAppStore((state) => state.sidebar)
  const chatMessages = useAppStore((state) => state.chatMessages)
  const layout = useAppStore((state) => state.layout)
  const actions = useAppStore((state) => state.actions)
  const threads = useAppStore((state) => state.threads)

  const chatFrameRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT)
  const [isDragging, setIsDragging] = useState(false)
  const [chatInputValue, setChatInputValue] = useState("")
  const [isSendingChatMessage, setIsSendingChatMessage] = useState(false)
  const [isApprovingPlan, setIsApprovingPlan] = useState(false)
  const [isApprovingSpecs, setIsApprovingSpecs] = useState(false)
  const [isStartingWork, setIsStartingWork] = useState(false)

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
  const activeChatMessagesFetchStatus = activeChatId
    ? (chatMessages.fetchStatusByChatId[activeChatId] ?? "idle")
    : "idle"
  const latestPlanApproval = findLatestChatMessageByType(
    activeChatMessages,
    "plan_approval",
  )
  const latestSpecApproval = findLatestChatMessageByType(
    activeChatMessages,
    "spec_approval",
  )
  const latestStartRequest = findLatestChatMessageByType(
    activeChatMessages,
    "thread_start_request",
  )
  const canApproveSpecs =
    latestPlanApproval !== null &&
    (latestSpecApproval === null ||
      latestPlanApproval.index > latestSpecApproval.index)
  const canStartWork =
    latestPlanApproval !== null &&
    latestSpecApproval !== null &&
    latestPlanApproval.index < latestSpecApproval.index &&
    (latestStartRequest === null ||
      latestSpecApproval.index > latestStartRequest.index)
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
  const chatWidth = Math.max(MIN_PANE_WIDTH, Math.round(availableWidth * splitRatio))
  const threadWidth = Math.max(MIN_PANE_WIDTH, availableWidth - chatWidth)

  const gridStyle: React.CSSProperties = containerWidth > 0
    ? { gridTemplateColumns: `${sidebarW}px ${chatWidth}px ${DRAG_HANDLE_WIDTH}px ${threadWidth}px` }
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
    if (!activeChatId) {
      return
    }

    fetchChatMessages(activeChatId, actions).catch((err) => {
      console.error("[chats] failed to fetch messages:", err)
    })
  }, [activeChatId, actions])

  useEffect(() => {
    if (!activeChatId || !capabilities?.supportsSubscriptions) {
      return
    }

    let cancelled = false
    let cleanup: (() => Promise<void>) | null = null

    subscribeToChatMessages(activeChatId, actions)
      .then((unsubscribe) => {
        if (cancelled) {
          void unsubscribe()
          return
        }
        cleanup = unsubscribe
      })
      .catch((err) => {
        console.error("[chats] failed to subscribe to messages:", err)
      })

    return () => {
      cancelled = true
      if (cleanup) {
        void cleanup()
      }
    }
  }, [activeChatId, capabilities?.supportsSubscriptions, actions])

  useEffect(() => {
    setChatInputValue("")
    setIsSendingChatMessage(false)
    setIsApprovingPlan(false)
    setIsApprovingSpecs(false)
    setIsStartingWork(false)
  }, [activeChatId])

  useEffect(() => {
    const container = transcriptScrollRef.current

    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [activeChatId, activeChatMessages.length])

  function handleSendChatMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!activeChat || isSendingChatMessage) {
      return
    }

    const prompt = chatInputValue.trim()

    if (!prompt) {
      return
    }

    setIsSendingChatMessage(true)
    sendChatMessage(activeChat.id, prompt, actions)
      .then(() => {
        setChatInputValue("")
      })
      .catch((err) => {
        console.error("[chats] failed to send message:", err)
      })
      .finally(() => {
        setIsSendingChatMessage(false)
      })
  }

  function handleSelectThread(threadId: string | null) {
    if (!activeProjectId) return
    actions.setLayoutField(activeProjectId, { selectedThreadId: threadId })
  }

  function handleApprovePlan() {
    if (!activeChat || isApprovingPlan || isApprovingSpecs || isStartingWork) {
      return
    }

    setIsApprovingPlan(true)
    approveChatPlan(activeChat.id, actions)
      .catch((err) => {
        console.error("[chats] failed to approve plan:", err)
      })
      .finally(() => {
        setIsApprovingPlan(false)
      })
  }

  function handleApproveSpecs() {
    if (
      !activeChat ||
      isApprovingPlan ||
      isApprovingSpecs ||
      isStartingWork ||
      !canApproveSpecs
    ) {
      return
    }

    setIsApprovingSpecs(true)
    approveChatSpecs(activeChat.id, actions)
      .catch((err) => {
        console.error("[chats] failed to approve specs:", err)
      })
      .finally(() => {
        setIsApprovingSpecs(false)
      })
  }

  function handleStartWork() {
    if (
      !activeProjectId ||
      !activeChat ||
      !latestPlanApproval?.message.id ||
      !latestSpecApproval?.message.id ||
      isApprovingPlan ||
      isApprovingSpecs ||
      isStartingWork ||
      !canStartWork
    ) {
      return
    }

    if (!window.confirm("Start work and create a thread from this chat?")) {
      return
    }

    setIsStartingWork(true)
    const projectId = activeProjectId
    startThreadFromChat({
      chatId: activeChat.id,
      title: activeChat.title,
      summary: null,
      planApprovalMessageId: latestPlanApproval.message.id,
      specApprovalMessageId: latestSpecApproval.message.id,
      confirmStart: true,
    })
      .then((threadDetail) => {
        actions.setLayoutField(projectId, { selectedThreadId: threadDetail.thread.id })
        return Promise.all([
          fetchThreads(projectId, actions),
          fetchChatMessages(activeChat.id, actions),
        ])
      })
      .catch((err) => {
        console.error("[chats] failed to start work:", err)
      })
      .finally(() => {
        setIsStartingWork(false)
      })
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
        <aside className={`chat-frame__rail ${sidebarCollapsed ? "chat-frame__rail--collapsed" : ""}`}>
          <Sidebar onOpenProject={onOpenProject} onOpenSettings={onOpenSettings} />
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
                  aria-label="Chat transcript shell"
                >
                  <div className="active-chat-pane__section-header">
                    <h3 className="active-chat-pane__section-title">
                      Transcript
                    </h3>
                    <span className="active-chat-pane__meta">
                      {activeChat.provider} · {activeChat.model}
                    </span>
                  </div>
                  <div
                    className="active-chat-pane__transcript-scroll"
                    ref={transcriptScrollRef}
                  >
                    {activeChatMessagesFetchStatus === "loading" &&
                    activeChatMessages.length === 0 ? (
                      <p className="active-chat-pane__transcript-empty">
                        Loading transcript…
                      </p>
                    ) : null}
                    {activeChatMessagesFetchStatus === "error" &&
                    activeChatMessages.length === 0 ? (
                      <p className="active-chat-pane__transcript-empty">
                        Unable to load transcript. Try reselecting this chat.
                      </p>
                    ) : null}
                    {activeChatMessagesFetchStatus === "idle" &&
                    activeChatMessages.length === 0 ? (
                      <p className="active-chat-pane__transcript-empty">
                        No messages yet. Send one to start this transcript.
                      </p>
                    ) : null}
                    {activeChatMessages.map((message) => (
                      <article
                        key={message.id}
                        className={`active-chat-pane__message active-chat-pane__message--${resolveChatMessageVariant(message)}`}
                      >
                        <span className="active-chat-pane__message-role">
                          {message.role}
                        </span>
                        <p className="active-chat-pane__message-text">
                          {message.contentMarkdown ??
                            "(Structured message payload)"}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>

                <aside
                  className="active-chat-pane__references"
                  aria-label="Chat references shell"
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
                      <dt>Messages</dt>
                      <dd>{activeChatMessages.length}</dd>
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
                onSubmit={handleSendChatMessage}
              >
                <div className="active-chat-pane__approval-actions">
                  <button
                    className="active-chat-pane__approval-action"
                    type="button"
                    onClick={handleApprovePlan}
                    disabled={isApprovingPlan || isApprovingSpecs || isStartingWork}
                  >
                    {isApprovingPlan ? "Approving plan…" : "Approve plan"}
                  </button>
                  <button
                    className="active-chat-pane__approval-action"
                    type="button"
                    onClick={handleApproveSpecs}
                    disabled={
                      isApprovingPlan ||
                      isApprovingSpecs ||
                      isStartingWork ||
                      !canApproveSpecs
                    }
                  >
                    {isApprovingSpecs ? "Approving specs…" : "Approve specs"}
                  </button>
                  <button
                    className="active-chat-pane__approval-action active-chat-pane__approval-action--primary"
                    type="button"
                    onClick={handleStartWork}
                    disabled={
                      isApprovingPlan ||
                      isApprovingSpecs ||
                      isStartingWork ||
                      !canStartWork
                    }
                  >
                    {isStartingWork ? "Starting…" : "Start work"}
                  </button>
                </div>
                <label className="active-chat-pane__input-label" htmlFor="chat-input">
                  Message
                </label>
                <div className="active-chat-pane__input-row">
                  <textarea
                    id="chat-input"
                    className="active-chat-pane__input"
                    rows={3}
                    placeholder="Ask the active chat to plan, code, or explain."
                    value={chatInputValue}
                    onChange={(event) => setChatInputValue(event.target.value)}
                    disabled={isSendingChatMessage}
                  />
                  <button
                    className="active-chat-pane__send"
                    type="submit"
                    disabled={isSendingChatMessage || chatInputValue.trim().length === 0}
                  >
                    {isSendingChatMessage ? "Sending…" : "Send"}
                  </button>
                </div>
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
