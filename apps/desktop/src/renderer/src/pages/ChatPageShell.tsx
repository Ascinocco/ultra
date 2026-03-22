import type {
  ChatTurnEventSnapshot,
  ChatTurnSnapshot,
  EnvironmentReadinessSnapshot,
  TerminalSessionSnapshot,
} from "@ultra/shared"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChatMessage } from "../chat-message/ChatMessage"

import { InputDock } from "../chats/input-dock/InputDock.js"
import { ApprovalDivider } from "../chats/approval-divider/ApprovalDivider.js"
import type { ApprovalDividerProps } from "../chats/approval-divider/ApprovalDivider.js"
import { PromoteDrawer } from "../chats/promote-drawer/PromoteDrawer.js"
import {
  cancelChatTurn,
  createPlanMarker,
  fetchChatMessages,
  fetchChatTurn,
  fetchChatTurns,
  gatherPromoteContext,
  promoteToThread,
  replayChatTurnEvents,
  selectCurrentTurn,
  startChatTurn,
  startThreadFromChat,
  subscribeToChatMessages,
  subscribeToChatTurnEvents,
} from "../chats/chat-message-workflows.js"
import {
  getAllModels,
  getDefaultModelForRuntimeProvider,
  getModelsForRuntimeProvider,
  getProviderForModel,
  type RuntimeProvider,
} from "../runtime-options.js"
import { useAutoScroll } from "../chats/hooks/useAutoScroll.js"
import { useStreamingBlocks } from "../chats/hooks/useStreamingBlocks.js"
import { StreamingMessage } from "../chats/streaming/StreamingMessage.js"
import { PersistedAssistantMessage } from "../chats/streaming/PersistedAssistantMessage.js"
import { hydrateSandboxes } from "../sandbox/sandbox-workflows.js"
import { Sidebar } from "../sidebar/Sidebar.js"
import { updateChatRuntimeConfig } from "../sidebar/chat-workflows.js"
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
  cancelThreadCoordinator,
  fetchThreadMessages,
  fetchThreads,
  sendThreadMessage,
  subscribeToThreadMessages,
  subscribeToThreadTurnEvents,
} from "../threads/thread-workflows.js"
import { useThreadStreaming } from "../threads/hooks/useThreadStreaming.js"

const DEFAULT_DRAWER_HEIGHT = 200
const MIN_DRAWER_HEIGHT = 100
const MAX_DRAWER_HEIGHT_RATIO = 0.8
const EMPTY_READINESS_CHECKS: EnvironmentReadinessSnapshot["checks"] = []

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
        <span className="terminal-drawer__hint-wrapper">
          <span className="terminal-drawer__hint-icon">ℹ</span>
          <span className="terminal-drawer__hint-tooltip">⌘K to generate a command</span>
        </span>
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
  const sandboxes = useAppStore((state) => state.sandboxes)
  const sidebar = useAppStore((state) => state.sidebar)
  const layout = useAppStore((state) => state.layout)
  const chatMessages = useAppStore((state) => state.chatMessages)
  const chatTurns = useAppStore((state) => state.chatTurns)
  const readinessChecks = useAppStore(
    (state) => state.readiness.snapshot?.checks ?? EMPTY_READINESS_CHECKS,
  )
  const actions = useAppStore((state) => state.actions)
  const threads = useAppStore((state) => state.threads)

  const chatFrameRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const turnSequenceRef = useRef<Record<string, number>>({})
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT)
  const [isDragging, setIsDragging] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
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
  // Derive plan state from messages
  const planState = useMemo((): "idle" | "planning" | "ready" => {
    let lastOpen = -1
    let lastClose = -1
    for (let i = activeChatMessages.length - 1; i >= 0; i--) {
      const mt = activeChatMessages[i]!.messageType
      if (mt === "plan_marker_open" && lastOpen === -1) lastOpen = i
      if (mt === "plan_marker_close" && lastClose === -1) lastClose = i
    }
    if (lastOpen !== -1 && (lastClose === -1 || lastOpen > lastClose)) return "planning"
    if (lastClose !== -1 && lastClose > lastOpen) return "ready"
    return "idle"
  }, [activeChatMessages])

  const planMarkerOpen = planState === "planning"

  const contextMessageIds = activeChatMessages ? gatherPromoteContext(activeChatMessages) : []

  const hasPromotedRecently = activeChatMessages?.some(
    (m, i) =>
      m.messageType === "thread_start_request" &&
      !activeChatMessages.slice(i + 1).some(
        (m2) => m2.role === "user" && !m2.messageType?.startsWith("plan_marker")
      ),
  ) ?? false

  const [promoting, setPromoting] = useState(false)

  function handlePlanMarker(markerType: "open" | "close") {
    if (!activeChatId) return
    void createPlanMarker(activeChatId, markerType, actions)
  }

  function handleStartPlan() {
    handlePlanMarker("open")
  }

  function handleFinishPlan() {
    handlePlanMarker("close")
  }

  function handleNewPlan() {
    if (!activeChatId) return
    // Close current plan, then immediately open a new one
    void createPlanMarker(activeChatId, "close", actions).then(() => {
      void createPlanMarker(activeChatId, "open", actions)
    })
  }

  async function handlePromote() {
    if (!activeChatId || !activeChat || !activeProjectId || contextMessageIds.length === 0) return
    setPromoting(true)
    try {
      await promoteToThread(activeChatId, activeChat.title, contextMessageIds)
      await fetchChatMessages(activeChatId, actions)
      await fetchThreads(activeProjectId, actions)
    } finally {
      setPromoting(false)
    }
  }

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
  const [cancelRequested, setCancelRequested] = useState(false)
  const [runtimeProviderDraft, setRuntimeProviderDraft] =
    useState<RuntimeProvider>(activeChat?.provider ?? "codex")
  const [runtimeModelDraft, setRuntimeModelDraft] = useState(
    activeChat?.model ?? getDefaultModelForRuntimeProvider("codex"),
  )
  const [runtimeUpdateStatus, setRuntimeUpdateStatus] = useState<
    "idle" | "saving" | "error"
  >("idle")
  const [runtimeUpdateError, setRuntimeUpdateError] = useState<string | null>(
    null,
  )
  const isPreSendRuntimeConfig = activeChatMessages.length === 0
  const availableModels = getAllModels()
  const latestTurnEvent = activeTurnEvents[activeTurnEvents.length - 1] ?? null
  const inFlightTurn =
    activeTurn?.status === "queued" || activeTurn?.status === "running"

  const { blocks: streamingBlocks, isStreaming } = useStreamingBlocks(
    activeTurnEvents,
    inFlightTurn,
    activeChatMessages.length,
  )

  useAutoScroll(transcriptScrollRef, [activeChatMessages, streamingBlocks])

  useEffect(() => {
    if (!inFlightTurn) {
      setCancelRequested(false)
    }
  }, [inFlightTurn])
  const readyRuntimeProviders = useMemo(() => {
    const providers: RuntimeProvider[] = []
    const hasClaude = readinessChecks.some(
      (check) => check.tool === "claude" && check.status === "ready",
    )
    const hasCodex = readinessChecks.some(
      (check) => check.tool === "codex" && check.status === "ready",
    )
    if (hasClaude) {
      providers.push("claude")
    }
    if (hasCodex) {
      providers.push("codex")
    }
    return providers
  }, [readinessChecks])
  const hasRuntimeReadinessSignals = readinessChecks.some(
    (check) => check.tool === "claude" || check.tool === "codex",
  )
  const selectedProviderReady =
    !hasRuntimeReadinessSignals ||
    readyRuntimeProviders.includes(runtimeProviderDraft)
  const selectedProviderReadinessCheck = useMemo(
    () =>
      readinessChecks.find((check) => check.tool === runtimeProviderDraft) ??
      null,
    [readinessChecks, runtimeProviderDraft],
  )
  const selectedProviderUnavailableHint = !selectedProviderReady
    ? [
        "The selected provider is unavailable in this environment.",
        selectedProviderReadinessCheck?.helpText ?? null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
    : null
  const activeTurnFailureHint =
    activeTurn?.status === "failed"
      ? (activeTurn.failureMessage?.trim() || "Chat turn failed.")
      : null
  const runtimeDraftDirty =
    activeChat != null &&
    (activeChat.provider !== runtimeProviderDraft ||
      activeChat.model !== runtimeModelDraft)
  const chatInputDisabled =
    !activeChatId ||
    connectionStatus !== "connected" ||
    chatTurnSendStatus === "starting" ||
    inFlightTurn ||
    runtimeUpdateStatus === "saving" ||
    !selectedProviderReady
  const activeSandboxId = activeProjectId
    ? (sandboxes.activeByProjectId[activeProjectId] ?? null)
    : null
  const terminalSessions = activeProjectId
    ? (terminal.sessionsByProjectId[activeProjectId] ?? [])
        .filter((s) =>
          s.status === "running" &&
          (!activeSandboxId || s.sandboxId === activeSandboxId),
        )
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
      .filter((t) => !activeChatId || t.sourceChatId === activeChatId)
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
    const threadId = selectedThreadId
    if (!threadId) return

    let cancelled = false
    let messageUnsub: (() => Promise<void>) | null = null
    let turnUnsub: (() => Promise<void>) | null = null

    subscribeToThreadMessages(threadId, actions).then((unsub) => {
      if (cancelled) { void unsub(); return }
      messageUnsub = unsub
    })

    subscribeToThreadTurnEvents(threadId, actions).then((unsub) => {
      if (cancelled) { void unsub(); return }
      turnUnsub = unsub
    })

    return () => {
      cancelled = true
      void messageUnsub?.()
      void turnUnsub?.()
      actions.setActiveThreadTurn(null)
    }
  }, [selectedThreadId, actions])

  useEffect(() => {
    if (!activeChatId) {
      turnSequenceRef.current = {}
    }
  }, [activeChatId])

  useEffect(() => {
    if (!activeChat) {
      return
    }

    setRuntimeProviderDraft(activeChat.provider)
    setRuntimeModelDraft(activeChat.model)
    setRuntimeUpdateStatus("idle")
    setRuntimeUpdateError(null)
  }, [activeChat])

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

      // Refresh sandboxes after turn completes (LLM may have created worktrees)
      if (event.eventType === "chat.turn_completed" && activeProjectId) {
        void hydrateSandboxes(activeProjectId, actions).catch(() => {})
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

  const persistRuntimeDraft = useCallback(
    async (
      provider: RuntimeProvider,
      model: string,
      thinkingLevel?: string,
      permissionLevel?: string,
    ): Promise<void> => {
      if (!activeChatId || !activeChat) {
        return
      }

      setRuntimeUpdateStatus("saving")
      setRuntimeUpdateError(null)

      try {
        await updateChatRuntimeConfig(
          activeChatId,
          {
            provider,
            model,
            thinkingLevel: thinkingLevel ?? activeChat.thinkingLevel,
            permissionLevel: permissionLevel ?? activeChat.permissionLevel,
          },
          actions,
        )
        setRuntimeUpdateStatus("idle")
      } catch (error) {
        setRuntimeUpdateStatus("error")
        setRuntimeUpdateError(getErrorMessage(error))
        throw error
      }
    },
    [activeChat, activeChatId, actions],
  )

  const handleSend = (prompt: string, attachments: File[]) => {
    if (!activeChatId || !activeChat || !prompt.trim() || chatInputDisabled) return

    const run = async () => {
      // Serialize file attachments to base64
      const serializedAttachments = await Promise.all(
        attachments.map(async (file) => {
          const buffer = await file.arrayBuffer()
          const data = btoa(
            new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""),
          )
          return {
            type: (file.type.startsWith("image/") ? "image" : "text") as "image" | "text",
            name: file.name,
            media_type: file.type || "application/octet-stream",
            data,
          }
        }),
      )
      const firstTurnRuntimeConfig =
        isPreSendRuntimeConfig && runtimeDraftDirty
          ? {
              provider: runtimeProviderDraft,
              model: runtimeModelDraft,
              thinkingLevel: activeChat.thinkingLevel,
              permissionLevel: activeChat.permissionLevel,
            }
          : undefined

      const { turn } = await startChatTurn(
        activeChatId,
        prompt,
        actions,
        undefined,
        firstTurnRuntimeConfig,
        serializedAttachments.length > 0 ? serializedAttachments : undefined,
      )

      const replayResult = await replayChatTurnEvents(
        activeChatId,
        turn.turnId,
        actions,
        turnSequenceRef.current[turn.turnId],
      )
      recordTurnSequence(replayResult.events)
      await fetchChatTurn(activeChatId, turn.turnId, actions)
    }

    void run().catch((err) => {
      console.error("[chat] failed to start turn:", err)
    })
  }

  const handleRuntimeConfigChange = (config: {
    provider?: string
    model?: string
    thinkingLevel?: string
    permissionLevel?: string
  }) => {
    if (!activeChatId || !activeChat) return

    const nextModel = config.model ?? (isPreSendRuntimeConfig ? runtimeModelDraft : activeChat.model)
    // Infer provider from model selection
    const nextProvider = config.model
      ? getProviderForModel(config.model)
      : (config.provider as RuntimeProvider | undefined) ?? (isPreSendRuntimeConfig ? runtimeProviderDraft : activeChat.provider) as RuntimeProvider

    void persistRuntimeDraft(
      nextProvider,
      nextModel,
      config.thinkingLevel,
      config.permissionLevel,
    )
  }

  function handleCancelTurn() {
    if (!activeChatId || !activeTurnId || cancelRequested) {
      return
    }

    setCancelRequested(true)
    void cancelChatTurn(activeChatId, activeTurnId).catch((err) => {
      console.error("[chat] failed to cancel turn:", err)
      setCancelRequested(false)
    })
  }

  function handleCancelCoordinator(threadId: string) {
    void cancelThreadCoordinator(threadId).catch((err) => {
      console.error("[threads] failed to cancel coordinator:", err)
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

  const threadTurnEvents = selectedThreadId
    ? (threads.turnEventsByThreadId[selectedThreadId] ?? [])
    : []
  const isCoordinatorActive = selectedThreadId != null && threads.activeThreadTurnId === selectedThreadId
  const threadMessages = selectedThreadId
    ? (threads.messagesByThreadId[selectedThreadId] ?? [])
    : []

  const threadStreaming = useThreadStreaming(
    threadTurnEvents,
    isCoordinatorActive,
    threadMessages.length,
  )

  const streamingBlocksByThreadId = useMemo(() => {
    if (!selectedThreadId || !threadStreaming.blocks) return {}
    return { [selectedThreadId]: threadStreaming.blocks }
  }, [selectedThreadId, threadStreaming.blocks])

  const isStreamingByThreadId = useMemo(() => {
    if (!selectedThreadId) return {}
    return { [selectedThreadId]: threadStreaming.isStreaming }
  }, [selectedThreadId, threadStreaming.isStreaming])

  const handleSendThreadMessage = useCallback(
    async (threadId: string, content: string, _files: File[]) => {
      await sendThreadMessage(threadId, content, actions)
    },
    [actions],
  )

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
          {activeChat ? (
            <section className="active-chat-pane" aria-label="Active chat pane">
              <div className={`active-chat-pane__body${referencesOpen ? "" : " active-chat-pane__body--refs-hidden"}`}>
                <section
                  className="active-chat-pane__transcript"
                  aria-label="Chat transcript"
                >
                  <button
                    type="button"
                    className="active-chat-pane__debug-toggle"
                    onClick={() => setReferencesOpen((prev) => !prev)}
                    title="Toggle debug info"
                    aria-label="Toggle references panel"
                  >
                    ℹ
                  </button>
                  <div className="active-chat-pane__transcript-scroll" ref={transcriptScrollRef}>
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
                        Start building with Ultra
                      </p>
                    ) : null}
                    {activeChatMessages.map((message) => {
                      if (
                        message.messageType === "plan_approval" ||
                        message.messageType === "spec_approval" ||
                        message.messageType === "thread_start_request" ||
                        message.messageType === "plan_marker_open" ||
                        message.messageType === "plan_marker_close"
                      ) {
                        return (
                          <ApprovalDivider
                            key={message.id}
                            messageType={
                              message.messageType as ApprovalDividerProps["messageType"]
                            }
                          />
                        )
                      }
                      // Render assistant messages with structured blocks (tool activity)
                      if (message.role === "assistant" && message.structuredPayloadJson) {
                        try {
                          const parsed = JSON.parse(message.structuredPayloadJson)
                          if (parsed.blocks && Array.isArray(parsed.blocks)) {
                            return (
                              <PersistedAssistantMessage
                                key={message.id}
                                blocks={parsed.blocks}
                              />
                            )
                          }
                        } catch {
                          // Fall through to default rendering
                        }
                      }
                      {
                        let parsedAttachments: Array<{ name: string; type: "image" | "text"; media_type: string }> | undefined
                        if (message.role === "user" && message.structuredPayloadJson) {
                          try {
                            const payload = JSON.parse(message.structuredPayloadJson)
                            if (payload.attachments && Array.isArray(payload.attachments)) {
                              parsedAttachments = payload.attachments
                            }
                          } catch { /* ignore */ }
                        }
                        return (
                          <ChatMessage
                            key={message.id}
                            role={message.role as "user" | "assistant" | "system"}
                            content={
                              message.contentMarkdown ??
                              message.structuredPayloadJson ??
                              "No text content."
                            }
                            attachments={parsedAttachments}
                          />
                        )
                      }
                    })}
                    {streamingBlocks !== null && (
                      <StreamingMessage
                        blocks={streamingBlocks}
                        isStreaming={isStreaming}
                      />
                    )}
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

              <div className="chat-input-stack">
              <PromoteDrawer
                messageCount={contextMessageIds.length}
                planState={planState}
                promoting={promoting}
                hasPromotedRecently={hasPromotedRecently}
                onStartPlan={handleStartPlan}
                onFinishPlan={handleFinishPlan}
                onNewPlan={handleNewPlan}
                onPromote={() => void handlePromote()}
              />
              <InputDock
                chatId={activeChatId!}
                disabled={chatInputDisabled}
                isFirstTurn={isPreSendRuntimeConfig}
                isGenerating={inFlightTurn}
                provider={isPreSendRuntimeConfig ? runtimeProviderDraft : activeChat.provider}
                model={isPreSendRuntimeConfig ? runtimeModelDraft : activeChat.model}
                thinkingLevel={activeChat.thinkingLevel}
                permissionLevel={activeChat.permissionLevel}
                availableModels={availableModels}
                onPlanMarker={handlePlanMarker}
                onPromote={() => void handlePromote()}
                onCancel={handleCancelTurn}
                planMarkerOpen={planMarkerOpen}
                onSend={handleSend}
                onRuntimeConfigChange={handleRuntimeConfigChange}
              />
              </div>
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
          <ThreadPane
            threads={projectThreads}
            selectedThreadId={selectedThreadId}
            messagesByThreadId={threads.messagesByThreadId}
            streamingBlocksByThreadId={streamingBlocksByThreadId}
            isStreamingByThreadId={isStreamingByThreadId}
            activeThreadTurnId={threads.activeThreadTurnId}
            fetchStatus={threadFetchStatus}
            onSelectThread={handleSelectThread}
            onFetchMessages={handleFetchMessages}
            onSendMessage={handleSendThreadMessage}
            onCancelCoordinator={handleCancelCoordinator}
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
