import type {
  CommandMethodName,
  QueryMethodName,
  SubscriptionEventEnvelope,
  SubscriptionMethodName,
} from "@ultra/shared"
import type { OpenDialogOptions } from "electron"
import { BrowserWindow, dialog, ipcMain } from "electron"

import type { BackendConnection } from "./backend-connection.js"

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

export function registerShellIpc(connection: BackendConnection): () => void {
  const activeSubscriptions = new Map<string, { cleanup: () => void }>()

  ipcMain.handle(GET_BACKEND_STATUS_CHANNEL, () => connection.getStatus())
  ipcMain.handle(SYSTEM_PING_CHANNEL, () => connection.ping())
  ipcMain.handle(GET_BACKEND_INFO_CHANNEL, () => connection.getBackendInfo())
  ipcMain.handle(RETRY_BACKEND_STARTUP_CHANNEL, () => connection.retryStartup())
  ipcMain.handle(PICK_PROJECT_DIRECTORY_CHANNEL, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const firstWindow = BrowserWindow.getAllWindows()[0]
    const pickerOptions: OpenDialogOptions = {
      title: "Open Project",
      buttonLabel: "Open Project",
      properties: ["openDirectory"],
    }

    const ownerWindow = focusedWindow ?? firstWindow
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, pickerOptions)
      : await dialog.showOpenDialog(pickerOptions)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_QUERY_CHANNEL, (_event, name: string, payload: unknown) =>
    connection.query(name as QueryMethodName, payload),
  )
  ipcMain.handle(
    IPC_COMMAND_CHANNEL,
    async (_event, name: string, payload: unknown) => {
      try {
        return await connection.command(name as CommandMethodName, payload)
      } catch (err) {
        console.error(`[ipc-command] CRASH in "${name}":`, err)
        throw err
      }
    },
  )
  ipcMain.handle(
    IPC_SUBSCRIBE_CHANNEL,
    async (event, name: string, payload: unknown) => {
      const sender = event.sender
      const { subscriptionId, unsubscribe } = await connection.subscribeToIpc(
        name as SubscriptionMethodName,
        payload,
        (subscriptionEvent: SubscriptionEventEnvelope) => {
          if (!sender.isDestroyed()) {
            sender.send(IPC_SUBSCRIPTION_EVENT_CHANNEL, subscriptionEvent)
          }
        },
      )

      activeSubscriptions.set(subscriptionId, {
        cleanup: unsubscribe,
      })

      sender.once("destroyed", () => {
        cleanupSubscription(activeSubscriptions, subscriptionId)
      })

      return { subscriptionId }
    },
  )
  ipcMain.handle(IPC_UNSUBSCRIBE_CHANNEL, (_event, subscriptionId: string) => {
    cleanupSubscription(activeSubscriptions, subscriptionId)
  })

  const unsubscribe = connection.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(BACKEND_STATUS_CHANGED_CHANNEL, status)
    }
  })

  return () => {
    unsubscribe()
    ipcMain.removeHandler(GET_BACKEND_STATUS_CHANNEL)
    ipcMain.removeHandler(SYSTEM_PING_CHANNEL)
    ipcMain.removeHandler(GET_BACKEND_INFO_CHANNEL)
    ipcMain.removeHandler(RETRY_BACKEND_STARTUP_CHANNEL)
    ipcMain.removeHandler(PICK_PROJECT_DIRECTORY_CHANNEL)
    ipcMain.removeHandler(IPC_QUERY_CHANNEL)
    ipcMain.removeHandler(IPC_COMMAND_CHANNEL)
    ipcMain.removeHandler(IPC_SUBSCRIBE_CHANNEL)
    ipcMain.removeHandler(IPC_UNSUBSCRIBE_CHANNEL)

    for (const subscriptionId of activeSubscriptions.keys()) {
      cleanupSubscription(activeSubscriptions, subscriptionId)
    }
  }
}

function cleanupSubscription(
  activeSubscriptions: Map<string, { cleanup: () => void }>,
  subscriptionId: string,
): void {
  const runtime = activeSubscriptions.get(subscriptionId)

  if (!runtime) {
    return
  }

  activeSubscriptions.delete(subscriptionId)
  runtime.cleanup()
}
