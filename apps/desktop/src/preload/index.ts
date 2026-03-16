import type {
  BackendInfoSnapshot,
  SubscriptionEventEnvelope,
  SystemPingResult,
} from "@ultra/shared"
import { APP_NAME } from "@ultra/shared"
import { contextBridge, ipcRenderer } from "electron"
import { OPEN_SYSTEM_TOOLS_CHANNEL } from "../main/app-menu.js"
import type {
  BackendStatusListener,
  BackendStatusSnapshot,
} from "../shared/backend-status.js"

const GET_BACKEND_STATUS_CHANNEL = "ultra-shell:get-backend-status"
const BACKEND_STATUS_CHANGED_CHANNEL = "ultra-shell:backend-status-changed"
const SYSTEM_PING_CHANNEL = "ultra-shell:system-ping"
const GET_BACKEND_INFO_CHANNEL = "ultra-shell:get-backend-info"
const RETRY_BACKEND_STARTUP_CHANNEL = "ultra-shell:retry-backend-startup"
const IPC_QUERY_CHANNEL = "ultra-shell:ipc-query"
const IPC_COMMAND_CHANNEL = "ultra-shell:ipc-command"
const IPC_SUBSCRIBE_CHANNEL = "ultra-shell:ipc-subscribe"
const IPC_UNSUBSCRIBE_CHANNEL = "ultra-shell:ipc-unsubscribe"
const IPC_SUBSCRIPTION_EVENT_CHANNEL = "ultra-shell:ipc-subscription-event"
const PICK_PROJECT_DIRECTORY_CHANNEL = "ultra-shell:pick-project-directory"

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
  ipcQuery: (name: string, payload?: unknown) =>
    ipcRenderer.invoke(IPC_QUERY_CHANNEL, name, payload) as Promise<unknown>,
  ipcCommand: (name: string, payload?: unknown) =>
    ipcRenderer.invoke(IPC_COMMAND_CHANNEL, name, payload) as Promise<unknown>,
  ipcSubscribe: (name: string, payload?: unknown) =>
    ipcRenderer.invoke(IPC_SUBSCRIBE_CHANNEL, name, payload) as Promise<{
      subscriptionId: string
    }>,
  ipcUnsubscribe: (subscriptionId: string) =>
    ipcRenderer.invoke(
      IPC_UNSUBSCRIBE_CHANNEL,
      subscriptionId,
    ) as Promise<void>,
  onIpcSubscriptionEvent: (
    listener: (event: SubscriptionEventEnvelope) => void,
  ) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      subscriptionEvent: SubscriptionEventEnvelope,
    ) => {
      listener(subscriptionEvent)
    }

    ipcRenderer.on(IPC_SUBSCRIPTION_EVENT_CHANNEL, wrappedListener)

    return () => {
      ipcRenderer.removeListener(
        IPC_SUBSCRIPTION_EVENT_CHANNEL,
        wrappedListener,
      )
    }
  },
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
}

contextBridge.exposeInMainWorld("ultraShell", ultraShell)
