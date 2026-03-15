import type {
  BackendCapabilities,
  ConnectionStatus,
  EnvironmentReadinessSnapshot,
  ProjectLayoutState,
  ProjectSnapshot,
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

type AppActions = {
  setCurrentPage: (page: AppPage) => void
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
  setReadinessChecking: () => void
  setReadinessSnapshot: (snapshot: EnvironmentReadinessSnapshot) => void
  setReadinessError: (error: string) => void
  resetReadiness: () => void
  setSystemToolsOpen: (open: boolean) => void
}

export type AppStoreState = {
  app: AppSlice
  readiness: ReadinessSlice
  projects: ProjectsSlice
  layout: LayoutSlice
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

const DEFAULT_LAYOUT: ProjectLayoutState = {
  currentPage: "chat",
  rightTopCollapsed: false,
  rightBottomCollapsed: false,
  selectedRightPaneTab: null,
  selectedBottomPaneTab: null,
  activeChatId: null,
  selectedThreadId: null,
  lastEditorTargetId: null,
}

const layoutPersistTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
    actions: {
      setCurrentPage: () => undefined,
      setConnectionStatus: () => undefined,
      setBackendStatus: () => undefined,
      setCapabilities: () => undefined,
      setActiveProjectId: () => undefined,
      setProjectOpenState: () => undefined,
      setProjects: () => undefined,
      upsertProject: () => undefined,
      setLayoutForProject: () => undefined,
      setLayoutField: () => undefined,
      setReadinessChecking: () => undefined,
      setReadinessSnapshot: () => undefined,
      setReadinessError: () => undefined,
      resetReadiness: () => undefined,
      setSystemToolsOpen: () => undefined,
    },
  }
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
        set((state) => ({
          ...state,
          layout: {
            byProjectId: {
              ...state.layout.byProjectId,
              [projectId]: layout,
            },
          },
        })),
      setLayoutField: (projectId, partial) =>
        set((state) => {
          const current = state.layout.byProjectId[projectId] ?? DEFAULT_LAYOUT
          const merged = { ...current, ...partial }

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
    },
  }))
}

const AppStoreContext = createContext<AppStore | null>(null)

export function AppStoreProvider({
  children,
  initialState,
}: PropsWithChildren<{ initialState?: Partial<AppSlice> }>) {
  const storeRef = useRef<AppStore | null>(null)

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
