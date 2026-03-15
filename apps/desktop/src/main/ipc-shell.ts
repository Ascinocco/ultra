import { BrowserWindow, ipcMain } from "electron"

import type { BackendProcessManager } from "./backend-process.js"

const GET_BACKEND_STATUS_CHANNEL = "ultra-shell:get-backend-status"
const BACKEND_STATUS_CHANGED_CHANNEL = "ultra-shell:backend-status-changed"

export function registerShellIpc(manager: BackendProcessManager): () => void {
  ipcMain.handle(GET_BACKEND_STATUS_CHANNEL, () => manager.getStatus())

  const unsubscribe = manager.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(BACKEND_STATUS_CHANGED_CHANNEL, status)
    }
  })

  return () => {
    unsubscribe()
    ipcMain.removeHandler(GET_BACKEND_STATUS_CHANNEL)
  }
}
