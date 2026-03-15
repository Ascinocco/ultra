import type { BackendInfoSnapshot, SystemPingResult } from "@ultra/shared"
import { APP_NAME } from "@ultra/shared"
import { contextBridge, ipcRenderer } from "electron"
import { OPEN_SYSTEM_TOOLS_CHANNEL } from "../main/app-menu.js"
import type {
  BackendStatusListener,
  BackendStatusSnapshot,
} from "../shared/backend-status.js"
import type {
  EditorHostStatusListener,
  EditorHostStatusSnapshot,
} from "../shared/editor-host.js"

const GET_BACKEND_STATUS_CHANNEL = "ultra-shell:get-backend-status"
const BACKEND_STATUS_CHANGED_CHANNEL = "ultra-shell:backend-status-changed"
const SYSTEM_PING_CHANNEL = "ultra-shell:system-ping"
const GET_BACKEND_INFO_CHANNEL = "ultra-shell:get-backend-info"
const RETRY_BACKEND_STARTUP_CHANNEL = "ultra-shell:retry-backend-startup"
const IPC_QUERY_CHANNEL = "ultra-shell:ipc-query"
const IPC_COMMAND_CHANNEL = "ultra-shell:ipc-command"
const PICK_PROJECT_DIRECTORY_CHANNEL = "ultra-shell:pick-project-directory"
const PICK_PROJECT_FILE_CHANNEL = "ultra-shell:pick-project-file"
const SYNC_EDITOR_HOST_CHANNEL = "ultra-shell:sync-editor-host"
const GET_EDITOR_HOST_STATUS_CHANNEL = "ultra-shell:get-editor-host-status"
const EDITOR_HOST_STATUS_CHANGED_CHANNEL =
  "ultra-shell:editor-host-status-changed"
const EDITOR_OPEN_FILE_CHANNEL = "ultra-shell:editor-open-file"
const EDITOR_OPEN_TERMINAL_CHANNEL = "ultra-shell:editor-open-terminal"

const ultraShell = {
  appName: APP_NAME,
  chromeVersion: process.versions.chrome,
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  getBackendStatus: () =>
    ipcRenderer.invoke(
      GET_BACKEND_STATUS_CHANNEL,
    ) as Promise<BackendStatusSnapshot>,
  pingBackend: () =>
    ipcRenderer.invoke(SYSTEM_PING_CHANNEL) as Promise<SystemPingResult>,
  getBackendInfo: () =>
    ipcRenderer.invoke(
      GET_BACKEND_INFO_CHANNEL,
    ) as Promise<BackendInfoSnapshot>,
  retryBackendStartup: () =>
    ipcRenderer.invoke(
      RETRY_BACKEND_STARTUP_CHANNEL,
    ) as Promise<BackendStatusSnapshot>,
  pickProjectDirectory: () =>
    ipcRenderer.invoke(PICK_PROJECT_DIRECTORY_CHANNEL) as Promise<
      string | null
    >,
  pickProjectFile: (rootPath?: string | null) =>
    ipcRenderer.invoke(PICK_PROJECT_FILE_CHANNEL, rootPath ?? null) as Promise<
      string | null
    >,
  syncEditorHost: (payload: unknown) =>
    ipcRenderer.invoke(
      SYNC_EDITOR_HOST_CHANNEL,
      payload,
    ) as Promise<EditorHostStatusSnapshot>,
  getEditorHostStatus: () =>
    ipcRenderer.invoke(
      GET_EDITOR_HOST_STATUS_CHANNEL,
    ) as Promise<EditorHostStatusSnapshot>,
  openEditorFile: (path: string) =>
    ipcRenderer.invoke(EDITOR_OPEN_FILE_CHANNEL, path) as Promise<void>,
  openEditorTerminal: (cwd: string, label?: string) =>
    ipcRenderer.invoke(
      EDITOR_OPEN_TERMINAL_CHANNEL,
      cwd,
      label,
    ) as Promise<void>,
  ipcQuery: (name: string, payload?: unknown) =>
    ipcRenderer.invoke(IPC_QUERY_CHANNEL, name, payload) as Promise<unknown>,
  ipcCommand: (name: string, payload?: unknown) =>
    ipcRenderer.invoke(IPC_COMMAND_CHANNEL, name, payload) as Promise<unknown>,
  onBackendStatusChange: (listener: BackendStatusListener) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      status: BackendStatusSnapshot,
    ) => {
      listener(status)
    }

    ipcRenderer.on(BACKEND_STATUS_CHANGED_CHANNEL, wrappedListener)

    return () => {
      ipcRenderer.removeListener(
        BACKEND_STATUS_CHANGED_CHANNEL,
        wrappedListener,
      )
    }
  },
  onOpenSystemTools: (listener: () => void) => {
    const wrappedListener = () => {
      listener()
    }

    ipcRenderer.on(OPEN_SYSTEM_TOOLS_CHANNEL, wrappedListener)

    return () => {
      ipcRenderer.removeListener(OPEN_SYSTEM_TOOLS_CHANNEL, wrappedListener)
    }
  },
  onEditorHostStatusChange: (listener: EditorHostStatusListener) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      status: EditorHostStatusSnapshot,
    ) => {
      listener(status)
    }

    ipcRenderer.on(EDITOR_HOST_STATUS_CHANGED_CHANNEL, wrappedListener)

    return () => {
      ipcRenderer.removeListener(
        EDITOR_HOST_STATUS_CHANGED_CHANNEL,
        wrappedListener,
      )
    }
  },
}

contextBridge.exposeInMainWorld("ultraShell", ultraShell)
