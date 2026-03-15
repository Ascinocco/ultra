import type { BackendInfoSnapshot, SystemPingResult } from "@ultra/shared"
import { APP_NAME } from "@ultra/shared"
import { contextBridge, ipcRenderer } from "electron"

import type {
  BackendStatusListener,
  BackendStatusSnapshot,
} from "../shared/backend-status.js"

const GET_BACKEND_STATUS_CHANNEL = "ultra-shell:get-backend-status"
const BACKEND_STATUS_CHANGED_CHANNEL = "ultra-shell:backend-status-changed"
const SYSTEM_PING_CHANNEL = "ultra-shell:system-ping"
const GET_BACKEND_INFO_CHANNEL = "ultra-shell:get-backend-info"

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
}

contextBridge.exposeInMainWorld("ultraShell", ultraShell)
