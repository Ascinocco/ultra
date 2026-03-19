import type {
  BackendCapabilities,
  ChatMessageSnapshot,
  ChatSummary,
  ChatTurnEventSnapshot,
  ChatTurnSnapshot,
  ConnectionStatus,
  EnvironmentReadinessSnapshot,
  ProjectLayoutState,
  ProjectSnapshot,
  SandboxContextSnapshot,
  SavedCommandSnapshot,
  TerminalRuntimeProfileResult,
  TerminalSessionSnapshot,
  ThreadMessageSnapshot,
  ThreadSnapshot,
} from "@ultra/shared"
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useRef,
} from "react"
import type { StoreApi } from "zustand"
import { createStore, useStore } from "zustand"

import type { BackendStatusSnapshot } from "../../../shared/backend-status.js"
import { createInitialBackendStatus } from "../../../shared/backend-status.js"
import { ipcClient } from "../ipc/ipc-client.js"

export type AppPage = "chat" | "editor" | "browser"
export type { ConnectionStatus } from "@ultra/shared"
export type ProjectOpenStatus = "idle" | "opening" | "error"

type AppSlice = {
  currentPage: AppPage
  activeProjectId: string | null
  connectionStatus: ConnectionStatus
  backendStatus: BackendStatusSnapshot
  capabilities: BackendCapabilities | null
  projectOpenStatus: ProjectOpenStatus
  projectOpenError: string | null
}

type ReadinessStatus = "idle" | "checking" | "ready" | "blocked" | "error"

type ReadinessSlice = {
  status: ReadinessStatus
  snapshot: EnvironmentReadinessSnapshot | null
  error: string | null
  systemToolsOpen: boolean
}

type ProjectsSlice = {
  byId: Record<string, ProjectSnapshot>
  allIds: string[]
}

type LayoutSlice = {
  byProjectId: Record<string, ProjectLayoutState>
}

type SidebarSlice = {
  expandedProjectIds: string[]
  chatsByProjectId: Record<string, ChatSummary[]>
  chatsFetchStatus: Record<string, "idle" | "loading" | "error">
}

type ChatMessagesSlice = {
  messagesByChatId: Record<string, ChatMessageSnapshot[]>
  fetchStatusByChatId: Record<string, "idle" | "loading" | "error">
}

type ChatTurnsSlice = {
  turnsByChatId: Record<string, ChatTurnSnapshot[]>
  eventsByTurnId: Record<string, ChatTurnEventSnapshot[]>
  activeTurnIdByChatId: Record<string, string | null>
  fetchStatusByChatId: Record<string, "idle" | "loading" | "error">
  sendStatusByChatId: Record<string, "idle" | "starting" | "error">
  sendErrorByChatId: Record<string, string | null>
}

type SandboxSlice = {
  byId: Record<string, SandboxContextSnapshot>
  idsByProjectId: Record<string, string[]>
  activeByProjectId: Record<string, string | null>
  runtimeByProjectId: Record<string, TerminalRuntimeProfileResult | null>
}

type TerminalSlice = {
  drawerOpenByProjectId: Record<string, boolean>
  sessionsByProjectId: Record<string, TerminalSessionSnapshot[]>
  focusedSessionIdByProjectId: Record<string, string | null>
  savedCommandsByProjectId: Record<string, SavedCommandSnapshot[]>
  commandBarProvider: "claude" | "codex"
  commandBarModel: string
}

type ThreadsSlice = {
  threadsByProjectId: Record<string, ThreadSnapshot[]>
  messagesByThreadId: Record<string, ThreadMessageSnapshot[]>
  threadFetchStatus: Record<string, "idle" | "loading" | "error">
}

type AppActions = {
  setCurrentPage: (page: AppPage) => void
  toggleProjectExpanded: (projectId: string) => void
  setChatsForProject: (projectId: string, chats: ChatSummary[]) => void
  setChatsFetchStatus: (
    projectId: string,
    status: "idle" | "loading" | "error",
  ) => void
  upsertChat: (chat: ChatSummary) => void
  removeChat: (chatId: string, projectId: string) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setBackendStatus: (status: BackendStatusSnapshot) => void
  setCapabilities: (capabilities: BackendCapabilities | null) => void
  setActiveProjectId: (projectId: string | null) => void
  setProjectOpenState: (
    status: ProjectOpenStatus,
    error?: string | null,
  ) => void
  setProjects: (projects: ProjectSnapshot[]) => void
  upsertProject: (project: ProjectSnapshot) => void
  setLayoutForProject: (projectId: string, layout: ProjectLayoutState) => void
  setLayoutField: (
    projectId: string,
    partial: Partial<ProjectLayoutState>,
  ) => void
  setSandboxesForProject: (
    projectId: string,
    sandboxes: SandboxContextSnapshot[],
  ) => void
  setActiveSandboxIdForProject: (
    projectId: string,
    sandboxId: string | null,
  ) => void
  setRuntimeProfileForProject: (
    projectId: string,
    runtimeProfile: TerminalRuntimeProfileResult | null,
  ) => void
  setTerminalSessionsForProject: (
    projectId: string,
    sessions: TerminalSessionSnapshot[],
  ) => void
  upsertTerminalSession: (
    projectId: string,
    session: TerminalSessionSnapshot,
  ) => void
  setFocusedTerminalSession: (
    projectId: string,
    sessionId: string | null,
  ) => void
  setSavedCommandsForProject: (
    projectId: string,
    commands: SavedCommandSnapshot[],
  ) => void
  setTerminalDrawerOpen: (projectId: string, open: boolean) => void
  setCommandBarProvider: (provider: "claude" | "codex") => void
  setCommandBarModel: (model: string) => void
  setReadinessChecking: () => void
  setReadinessSnapshot: (snapshot: EnvironmentReadinessSnapshot) => void
  setReadinessError: (error: string) => void
  resetReadiness: () => void
  setSystemToolsOpen: (open: boolean) => void
  setThreadsForProject: (projectId: string, threads: ThreadSnapshot[]) => void
  setMessagesForChat: (chatId: string, messages: ChatMessageSnapshot[]) => void
  upsertChatMessage: (chatId: string, message: ChatMessageSnapshot) => void
  setChatMessagesFetchStatus: (
    chatId: string,
    status: "idle" | "loading" | "error",
  ) => void
  setChatTurnsFetchStatus: (
    chatId: string,
    status: "idle" | "loading" | "error",
  ) => void
  setTurnsForChat: (chatId: string, turns: ChatTurnSnapshot[]) => void
  upsertChatTurn: (chatId: string, turn: ChatTurnSnapshot) => void
  setActiveChatTurn: (chatId: string, turnId: string | null) => void
  setTurnEventsForTurn: (
    turnId: string,
    events: ChatTurnEventSnapshot[],
  ) => void
  appendChatTurnEvent: (event: ChatTurnEventSnapshot) => void
  setChatTurnSendState: (
    chatId: string,
    status: "idle" | "starting" | "error",
    error?: string | null,
  ) => void
  setMessagesForThread: (
    threadId: string,
    messages: ThreadMessageSnapshot[],
  ) => void
  appendMessage: (threadId: string, message: ThreadMessageSnapshot) => void
  setThreadFetchStatus: (
    projectId: string,
    status: "idle" | "loading" | "error",
  ) => void
}

export type AppStoreState = {
  app: AppSlice
  readiness: ReadinessSlice
  projects: ProjectsSlice
  layout: LayoutSlice
  sidebar: SidebarSlice
  chatMessages: ChatMessagesSlice
  chatTurns: ChatTurnsSlice
  sandboxes: SandboxSlice
  terminal: TerminalSlice
  threads: ThreadsSlice
  actions: AppActions
}

type AppStore = StoreApi<AppStoreState>

const defaultAppState: AppSlice = {
  currentPage: "chat",
  activeProjectId: null,
  connectionStatus: "connecting",
  backendStatus: createInitialBackendStatus(),
  capabilities: null,
  projectOpenStatus: "idle",
  projectOpenError: null,
}

const defaultProjectsState: ProjectsSlice = {
  byId: {},
  allIds: [],
}

const defaultReadinessState: ReadinessSlice = {
  status: "idle",
  snapshot: null,
  error: null,
  systemToolsOpen: false,
}

const defaultLayoutState: LayoutSlice = {
  byProjectId: {},
}

const defaultSidebarState: SidebarSlice = {
  expandedProjectIds: [],
  chatsByProjectId: {},
  chatsFetchStatus: {},
}

const defaultChatMessagesState: ChatMessagesSlice = {
  messagesByChatId: {},
  fetchStatusByChatId: {},
}

const defaultChatTurnsState: ChatTurnsSlice = {
  turnsByChatId: {},
  eventsByTurnId: {},
  activeTurnIdByChatId: {},
  fetchStatusByChatId: {},
  sendStatusByChatId: {},
  sendErrorByChatId: {},
}

const defaultSandboxState: SandboxSlice = {
  byId: {},
  idsByProjectId: {},
  activeByProjectId: {},
  runtimeByProjectId: {},
}

const defaultTerminalState: TerminalSlice = {
  drawerOpenByProjectId: {},
  sessionsByProjectId: {},
  focusedSessionIdByProjectId: {},
  savedCommandsByProjectId: {},
  commandBarProvider: "claude",
  commandBarModel: "claude-sonnet-4-6",
}

const defaultThreadsState: ThreadsSlice = {
  threadsByProjectId: {},
  messagesByThreadId: {},
  threadFetchStatus: {},
}

const DEFAULT_LAYOUT: ProjectLayoutState = {
  currentPage: "chat",
  rightTopCollapsed: false,
  selectedRightPaneTab: null,
  activeChatId: null,
  selectedThreadId: null,
  lastEditorTargetId: null,
  sidebarCollapsed: false,
  chatThreadSplitRatio: 0.55,
}

const layoutPersistTimers = new Map<string, ReturnType<typeof setTimeout>>()

function normalizeLayout(layout: ProjectLayoutState): ProjectLayoutState {
  return {
    ...DEFAULT_LAYOUT,
    ...layout,
    currentPage: "chat",
  }
}

function debouncedPersistLayout(
  projectId: string,
  getState: () => AppStoreState,
): void {
  const existing = layoutPersistTimers.get(projectId)

  if (existing) {
    clearTimeout(existing)
  }

  layoutPersistTimers.set(
    projectId,
    setTimeout(() => {
      layoutPersistTimers.delete(projectId)
      const layout = getState().layout.byProjectId[projectId]

      if (layout) {
        ipcClient
          .command("projects.set_layout", {
            project_id: projectId,
            layout,
          })
          .catch(() => {
            // Fire-and-forget — layout persist failures are non-fatal.
          })
      }
    }, 300),
  )
}

function buildInitialState(overrides?: Partial<AppSlice>): AppStoreState {
  const app = {
    ...defaultAppState,
    ...overrides,
  }

  return {
    app,
    readiness: { ...defaultReadinessState },
    projects: { ...defaultProjectsState },
    layout: { ...defaultLayoutState },
    sidebar: { ...defaultSidebarState },
    chatMessages: { ...defaultChatMessagesState },
    chatTurns: { ...defaultChatTurnsState },
    sandboxes: { ...defaultSandboxState },
    terminal: { ...defaultTerminalState },
    threads: { ...defaultThreadsState },
    actions: {
      setCurrentPage: () => undefined,
      toggleProjectExpanded: () => undefined,
      setChatsForProject: () => undefined,
      setChatsFetchStatus: () => undefined,
      upsertChat: () => undefined,
      removeChat: () => undefined,
      setConnectionStatus: () => undefined,
      setBackendStatus: () => undefined,
      setCapabilities: () => undefined,
      setActiveProjectId: () => undefined,
      setProjectOpenState: () => undefined,
      setProjects: () => undefined,
      upsertProject: () => undefined,
      setLayoutForProject: () => undefined,
      setLayoutField: () => undefined,
      setSandboxesForProject: () => undefined,
      setActiveSandboxIdForProject: () => undefined,
      setRuntimeProfileForProject: () => undefined,
      setTerminalSessionsForProject: () => undefined,
      upsertTerminalSession: () => undefined,
      setFocusedTerminalSession: () => undefined,
      setSavedCommandsForProject: () => undefined,
      setTerminalDrawerOpen: () => undefined,
      setCommandBarProvider: () => undefined,
      setCommandBarModel: () => undefined,
      setReadinessChecking: () => undefined,
      setReadinessSnapshot: () => undefined,
      setReadinessError: () => undefined,
      resetReadiness: () => undefined,
      setSystemToolsOpen: () => undefined,
      setThreadsForProject: () => undefined,
      setMessagesForChat: () => undefined,
      upsertChatMessage: () => undefined,
      setChatMessagesFetchStatus: () => undefined,
      setChatTurnsFetchStatus: () => undefined,
      setTurnsForChat: () => undefined,
      upsertChatTurn: () => undefined,
      setActiveChatTurn: () => undefined,
      setTurnEventsForTurn: () => undefined,
      appendChatTurnEvent: () => undefined,
      setChatTurnSendState: () => undefined,
      setMessagesForThread: () => undefined,
      appendMessage: () => undefined,
      setThreadFetchStatus: () => undefined,
    },
  }
}

function normalizeTurnEvents(
  events: ChatTurnEventSnapshot[],
): ChatTurnEventSnapshot[] {
  const byId = new Map<string, ChatTurnEventSnapshot>()

  for (const event of events) {
    byId.set(event.eventId, event)
  }

  return [...byId.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
}

function pickActiveTurnId(
  turns: ChatTurnSnapshot[],
  currentTurnId: string | null,
): string | null {
  if (currentTurnId && turns.some((turn) => turn.turnId === currentTurnId)) {
    return currentTurnId
  }

  const inFlight = turns.find(
    (turn) => turn.status === "queued" || turn.status === "running",
  )
  return inFlight?.turnId ?? turns[0]?.turnId ?? null
}

function normalizeProjects(projects: ProjectSnapshot[]): ProjectsSlice {
  const byId: Record<string, ProjectSnapshot> = {}
  const allIds: string[] = []

  for (const project of projects) {
    byId[project.id] = project
    allIds.push(project.id)
  }

  return { byId, allIds }
}

export function createAppStore(overrides?: Partial<AppSlice>): AppStore {
  return createStore<AppStoreState>()((set, get) => ({
    ...buildInitialState(overrides),
    actions: {
      setCurrentPage: (page) =>
        set((state) => ({
          ...state,
          app: { ...state.app, currentPage: page },
        })),
      toggleProjectExpanded: (projectId) =>
        set((state) => {
          const ids = state.sidebar.expandedProjectIds
          const next = ids.includes(projectId)
            ? ids.filter((id) => id !== projectId)
            : [...ids, projectId]
          return {
            ...state,
            sidebar: { ...state.sidebar, expandedProjectIds: next },
          }
        }),
      setChatsForProject: (projectId, chats) =>
        set((state) => ({
          ...state,
          sidebar: {
            ...state.sidebar,
            chatsByProjectId: {
              ...state.sidebar.chatsByProjectId,
              [projectId]: chats,
            },
            chatsFetchStatus: {
              ...state.sidebar.chatsFetchStatus,
              [projectId]: "idle",
            },
          },
        })),
      setChatsFetchStatus: (projectId, status) =>
        set((state) => ({
          ...state,
          sidebar: {
            ...state.sidebar,
            chatsFetchStatus: {
              ...state.sidebar.chatsFetchStatus,
              [projectId]: status,
            },
          },
        })),
      upsertChat: (chat) =>
        set((state) => {
          const existing = state.sidebar.chatsByProjectId[chat.projectId] ?? []
          const index = existing.findIndex((c) => c.id === chat.id)
          const updated =
            index >= 0
              ? existing.map((c) => (c.id === chat.id ? chat : c))
              : [...existing, chat]
          return {
            ...state,
            sidebar: {
              ...state.sidebar,
              chatsByProjectId: {
                ...state.sidebar.chatsByProjectId,
                [chat.projectId]: updated,
              },
            },
          }
        }),
      removeChat: (chatId, projectId) =>
        set((state) => {
          const existing = state.sidebar.chatsByProjectId[projectId] ?? []
          return {
            ...state,
            sidebar: {
              ...state.sidebar,
              chatsByProjectId: {
                ...state.sidebar.chatsByProjectId,
                [projectId]: existing.filter((c) => c.id !== chatId),
              },
            },
          }
        }),
      setConnectionStatus: (status) =>
        set((state) => ({
          ...state,
          app: { ...state.app, connectionStatus: status },
        })),
      setBackendStatus: (status) =>
        set((state) => ({
          ...state,
          app: {
            ...state.app,
            connectionStatus: status.connectionStatus,
            backendStatus: status,
            capabilities:
              status.connectionStatus === "connected"
                ? (status.capabilities ?? state.app.capabilities)
                : null,
          },
        })),
      setCapabilities: (capabilities) =>
        set((state) => ({
          ...state,
          app: { ...state.app, capabilities },
        })),
      setActiveProjectId: (projectId) =>
        set((state) => ({
          ...state,
          app: { ...state.app, activeProjectId: projectId },
        })),
      setProjectOpenState: (status, error = null) =>
        set((state) => ({
          ...state,
          app: {
            ...state.app,
            projectOpenStatus: status,
            projectOpenError: error,
          },
        })),
      setProjects: (projects) =>
        set((state) => ({
          ...state,
          projects: normalizeProjects(projects),
        })),
      upsertProject: (project) =>
        set((state) => {
          const byId = { ...state.projects.byId, [project.id]: project }
          const allIds = state.projects.allIds.includes(project.id)
            ? state.projects.allIds
            : [project.id, ...state.projects.allIds]

          return { ...state, projects: { byId, allIds } }
        }),
      setLayoutForProject: (projectId, layout) =>
        set((state) => {
          const normalized = normalizeLayout(layout)

          return {
            ...state,
            layout: {
              byProjectId: {
                ...state.layout.byProjectId,
                [projectId]: normalized,
              },
            },
            // Don't derive drawer state on hydration — terminal drawer
            // always starts closed and must be explicitly toggled open.
          }
        }),
      setLayoutField: (projectId, partial) =>
        set((state) => {
          const current = state.layout.byProjectId[projectId] ?? DEFAULT_LAYOUT
          const merged = normalizeLayout({ ...current, ...partial })

          debouncedPersistLayout(projectId, get)

          return {
            ...state,
            layout: {
              byProjectId: {
                ...state.layout.byProjectId,
                [projectId]: merged,
              },
            },
          }
        }),
      setSandboxesForProject: (projectId, sandboxes) =>
        set((state) => {
          const byId = { ...state.sandboxes.byId }

          for (const sandbox of sandboxes) {
            byId[sandbox.sandboxId] = sandbox
          }

          return {
            ...state,
            sandboxes: {
              ...state.sandboxes,
              byId,
              idsByProjectId: {
                ...state.sandboxes.idsByProjectId,
                [projectId]: sandboxes.map((sandbox) => sandbox.sandboxId),
              },
            },
          }
        }),
      setActiveSandboxIdForProject: (projectId, sandboxId) =>
        set((state) => ({
          ...state,
          sandboxes: {
            ...state.sandboxes,
            activeByProjectId: {
              ...state.sandboxes.activeByProjectId,
              [projectId]: sandboxId,
            },
          },
        })),
      setRuntimeProfileForProject: (projectId, runtimeProfile) =>
        set((state) => ({
          ...state,
          sandboxes: {
            ...state.sandboxes,
            runtimeByProjectId: {
              ...state.sandboxes.runtimeByProjectId,
              [projectId]: runtimeProfile,
            },
          },
        })),
      setTerminalSessionsForProject: (projectId, sessions) =>
        set((state) => {
          const currentFocused =
            state.terminal.focusedSessionIdByProjectId[projectId] ?? null
          const nextFocused =
            currentFocused &&
            sessions.some((session) => session.sessionId === currentFocused)
              ? currentFocused
              : (sessions[0]?.sessionId ?? null)

          return {
            ...state,
            terminal: {
              ...state.terminal,
              sessionsByProjectId: {
                ...state.terminal.sessionsByProjectId,
                [projectId]: sessions,
              },
              focusedSessionIdByProjectId: {
                ...state.terminal.focusedSessionIdByProjectId,
                [projectId]: nextFocused,
              },
            },
          }
        }),
      upsertTerminalSession: (projectId, session) =>
        set((state) => {
          const existing = state.terminal.sessionsByProjectId[projectId] ?? []
          const index = existing.findIndex(
            (entry) => entry.sessionId === session.sessionId,
          )
          const updated =
            index >= 0
              ? existing.map((entry) =>
                  entry.sessionId === session.sessionId ? session : entry,
                )
              : [session, ...existing]

          return {
            ...state,
            terminal: {
              ...state.terminal,
              sessionsByProjectId: {
                ...state.terminal.sessionsByProjectId,
                [projectId]: updated,
              },
              focusedSessionIdByProjectId: {
                ...state.terminal.focusedSessionIdByProjectId,
                [projectId]: session.sessionId,
              },
            },
          }
        }),
      setFocusedTerminalSession: (projectId, sessionId) =>
        set((state) => ({
          ...state,
          terminal: {
            ...state.terminal,
            focusedSessionIdByProjectId: {
              ...state.terminal.focusedSessionIdByProjectId,
              [projectId]: sessionId,
            },
          },
        })),
      setSavedCommandsForProject: (projectId, commands) =>
        set((state) => ({
          ...state,
          terminal: {
            ...state.terminal,
            savedCommandsByProjectId: {
              ...state.terminal.savedCommandsByProjectId,
              [projectId]: commands,
            },
          },
        })),
      setTerminalDrawerOpen: (projectId, open) =>
        set((state) => ({
          ...state,
          terminal: {
            ...state.terminal,
            drawerOpenByProjectId: {
              ...state.terminal.drawerOpenByProjectId,
              [projectId]: open,
            },
          },
        })),
      setCommandBarProvider: (cmdBarProvider) =>
        set((state) => ({
          ...state,
          terminal: {
            ...state.terminal,
            commandBarProvider: cmdBarProvider,
          },
        })),
      setCommandBarModel: (cmdBarModel) =>
        set((state) => ({
          ...state,
          terminal: {
            ...state.terminal,
            commandBarModel: cmdBarModel,
          },
        })),
      setReadinessChecking: () =>
        set((state) => ({
          ...state,
          readiness: {
            ...state.readiness,
            status: "checking",
            error: null,
          },
        })),
      setReadinessSnapshot: (snapshot) =>
        set((state) => ({
          ...state,
          readiness: {
            ...state.readiness,
            snapshot,
            status: snapshot.status,
            error: null,
          },
        })),
      setReadinessError: (error) =>
        set((state) => ({
          ...state,
          readiness: {
            ...state.readiness,
            status: "error",
            error,
          },
        })),
      resetReadiness: () =>
        set((state) => ({
          ...state,
          readiness: { ...defaultReadinessState },
        })),
      setSystemToolsOpen: (open) =>
        set((state) => ({
          ...state,
          readiness: {
            ...state.readiness,
            systemToolsOpen: open,
          },
        })),
      setThreadsForProject: (projectId, threads) =>
        set((state) => ({
          ...state,
          threads: {
            ...state.threads,
            threadsByProjectId: {
              ...state.threads.threadsByProjectId,
              [projectId]: threads,
            },
            threadFetchStatus: {
              ...state.threads.threadFetchStatus,
              [projectId]: "idle",
            },
          },
        })),
      setMessagesForChat: (chatId, messages) =>
        set((state) => ({
          ...state,
          chatMessages: {
            ...state.chatMessages,
            messagesByChatId: {
              ...state.chatMessages.messagesByChatId,
              [chatId]: messages,
            },
            fetchStatusByChatId: {
              ...state.chatMessages.fetchStatusByChatId,
              [chatId]: "idle",
            },
          },
        })),
      upsertChatMessage: (chatId, message) =>
        set((state) => {
          const existing = state.chatMessages.messagesByChatId[chatId] ?? []
          const alreadyPresent = existing.some(
            (entry) => entry.id === message.id,
          )
          const nextMessages = alreadyPresent
            ? existing
            : [...existing, message]

          return {
            ...state,
            chatMessages: {
              ...state.chatMessages,
              messagesByChatId: {
                ...state.chatMessages.messagesByChatId,
                [chatId]: nextMessages,
              },
            },
          }
        }),
      setChatMessagesFetchStatus: (chatId, status) =>
        set((state) => ({
          ...state,
          chatMessages: {
            ...state.chatMessages,
            fetchStatusByChatId: {
              ...state.chatMessages.fetchStatusByChatId,
              [chatId]: status,
            },
          },
        })),
      setChatTurnsFetchStatus: (chatId, status) =>
        set((state) => ({
          ...state,
          chatTurns: {
            ...state.chatTurns,
            fetchStatusByChatId: {
              ...state.chatTurns.fetchStatusByChatId,
              [chatId]: status,
            },
          },
        })),
      setTurnsForChat: (chatId, turns) =>
        set((state) => ({
          ...state,
          chatTurns: {
            ...state.chatTurns,
            turnsByChatId: {
              ...state.chatTurns.turnsByChatId,
              [chatId]: turns,
            },
            activeTurnIdByChatId: {
              ...state.chatTurns.activeTurnIdByChatId,
              [chatId]: pickActiveTurnId(
                turns,
                state.chatTurns.activeTurnIdByChatId[chatId] ?? null,
              ),
            },
            fetchStatusByChatId: {
              ...state.chatTurns.fetchStatusByChatId,
              [chatId]: "idle",
            },
          },
        })),
      upsertChatTurn: (chatId, turn) =>
        set((state) => {
          const existing = state.chatTurns.turnsByChatId[chatId] ?? []
          const index = existing.findIndex(
            (entry) => entry.turnId === turn.turnId,
          )
          const updated =
            index >= 0
              ? existing.map((entry) =>
                  entry.turnId === turn.turnId ? turn : entry,
                )
              : [turn, ...existing]
          const sorted = [...updated].sort(
            (a, b) =>
              b.startedAt.localeCompare(a.startedAt) ||
              b.turnId.localeCompare(a.turnId),
          )

          return {
            ...state,
            chatTurns: {
              ...state.chatTurns,
              turnsByChatId: {
                ...state.chatTurns.turnsByChatId,
                [chatId]: sorted,
              },
              activeTurnIdByChatId: {
                ...state.chatTurns.activeTurnIdByChatId,
                [chatId]: pickActiveTurnId(
                  sorted,
                  state.chatTurns.activeTurnIdByChatId[chatId] ?? null,
                ),
              },
            },
          }
        }),
      setActiveChatTurn: (chatId, turnId) =>
        set((state) => ({
          ...state,
          chatTurns: {
            ...state.chatTurns,
            activeTurnIdByChatId: {
              ...state.chatTurns.activeTurnIdByChatId,
              [chatId]: turnId,
            },
          },
        })),
      setTurnEventsForTurn: (turnId, events) =>
        set((state) => ({
          ...state,
          chatTurns: {
            ...state.chatTurns,
            eventsByTurnId: {
              ...state.chatTurns.eventsByTurnId,
              [turnId]: normalizeTurnEvents(events),
            },
          },
        })),
      appendChatTurnEvent: (event) =>
        set((state) => {
          const existing = state.chatTurns.eventsByTurnId[event.turnId] ?? []
          const nextEvents = normalizeTurnEvents([...existing, event])

          return {
            ...state,
            chatTurns: {
              ...state.chatTurns,
              eventsByTurnId: {
                ...state.chatTurns.eventsByTurnId,
                [event.turnId]: nextEvents,
              },
            },
          }
        }),
      setChatTurnSendState: (chatId, status, error = null) =>
        set((state) => ({
          ...state,
          chatTurns: {
            ...state.chatTurns,
            sendStatusByChatId: {
              ...state.chatTurns.sendStatusByChatId,
              [chatId]: status,
            },
            sendErrorByChatId: {
              ...state.chatTurns.sendErrorByChatId,
              [chatId]: status === "error" ? error : null,
            },
          },
        })),
      setMessagesForThread: (threadId, messages) =>
        set((state) => ({
          ...state,
          threads: {
            ...state.threads,
            messagesByThreadId: {
              ...state.threads.messagesByThreadId,
              [threadId]: messages,
            },
          },
        })),
      appendMessage: (threadId, message) =>
        set((state) => ({
          ...state,
          threads: {
            ...state.threads,
            messagesByThreadId: {
              ...state.threads.messagesByThreadId,
              [threadId]: [
                ...(state.threads.messagesByThreadId[threadId] ?? []),
                message,
              ],
            },
          },
        })),
      setThreadFetchStatus: (projectId, status) =>
        set((state) => ({
          ...state,
          threads: {
            ...state.threads,
            threadFetchStatus: {
              ...state.threads.threadFetchStatus,
              [projectId]: status,
            },
          },
        })),
    },
  }))
}

const AppStoreContext = createContext<AppStore | null>(null)

export function AppStoreProvider({
  children,
  initialState,
  store: externalStore,
}: PropsWithChildren<{ initialState?: Partial<AppSlice>; store?: AppStore }>) {
  const storeRef = useRef<AppStore | null>(externalStore ?? null)

  if (!storeRef.current) {
    storeRef.current = createAppStore(initialState)
  }

  return (
    <AppStoreContext.Provider value={storeRef.current}>
      {children}
    </AppStoreContext.Provider>
  )
}

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  const store = useContext(AppStoreContext)

  if (!store) {
    throw new Error(
      "AppStoreProvider is required before using the renderer store.",
    )
  }

  return useStore(store, selector)
}

export type { AppActions, AppStore }
