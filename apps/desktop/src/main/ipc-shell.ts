import { BrowserWindow, ipcMain } from "electron"

import type { CommandMethodName, QueryMethodName } from "@ultra/shared"

import type { BackendConnection } from "./backend-connection.js"

const GET_BACKEND_STATUS_CHANNEL = "ultra-shell:get-backend-status"
const BACKEND_STATUS_CHANGED_CHANNEL = "ultra-shell:backend-status-changed"
const SYSTEM_PING_CHANNEL = "ultra-shell:system-ping"
const GET_BACKEND_INFO_CHANNEL = "ultra-shell:get-backend-info"
const IPC_QUERY_CHANNEL = "ultra-shell:ipc-query"
const IPC_COMMAND_CHANNEL = "ultra-shell:ipc-command"

export function registerShellIpc(connection: BackendConnection): () => void {
  ipcMain.handle(GET_BACKEND_STATUS_CHANNEL, () => connection.getStatus())
  ipcMain.handle(SYSTEM_PING_CHANNEL, () => connection.ping())
  ipcMain.handle(GET_BACKEND_INFO_CHANNEL, () => connection.getBackendInfo())
  ipcMain.handle(
    IPC_QUERY_CHANNEL,
    (_event, name: string, payload: unknown) =>
      connection.query(name as QueryMethodName, payload),
  )
  ipcMain.handle(
    IPC_COMMAND_CHANNEL,
    (_event, name: string, payload: unknown) =>
      connection.command(name as CommandMethodName, payload),
  )

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
    ipcMain.removeHandler(IPC_QUERY_CHANNEL)
    ipcMain.removeHandler(IPC_COMMAND_CHANNEL)
  }
}
