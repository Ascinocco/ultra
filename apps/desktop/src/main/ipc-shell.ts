import type { CommandMethodName, QueryMethodName } from "@ultra/shared"
import type { OpenDialogOptions } from "electron"
import { BrowserWindow, dialog, ipcMain } from "electron"
import type { BackendConnection } from "./backend-connection.js"
import type { EditorWorkspaceHost } from "./editor-workspace-host.js"

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

export function registerShellIpc(
  connection: BackendConnection,
  editorHost: EditorWorkspaceHost,
): () => void {
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
  ipcMain.handle(
    PICK_PROJECT_FILE_CHANNEL,
    async (_event, rootPath: string | null | undefined) => {
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const firstWindow = BrowserWindow.getAllWindows()[0]
      const pickerOptions: OpenDialogOptions = {
        title: "Open Project File",
        buttonLabel: "Open File",
        properties: ["openFile"],
      }

      if (rootPath) {
        pickerOptions.defaultPath = rootPath
      }

      const ownerWindow = focusedWindow ?? firstWindow
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, pickerOptions)
        : await dialog.showOpenDialog(pickerOptions)

      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  )
  ipcMain.handle(SYNC_EDITOR_HOST_CHANNEL, (_event, payload: unknown) =>
    editorHost.sync(payload as never),
  )
  ipcMain.handle(GET_EDITOR_HOST_STATUS_CHANNEL, () => editorHost.getStatus())
  ipcMain.handle(EDITOR_OPEN_FILE_CHANNEL, (_event, path: string) =>
    editorHost.openFile(path),
  )
  ipcMain.handle(
    EDITOR_OPEN_TERMINAL_CHANNEL,
    (_event, cwd: string, label?: string) =>
      editorHost.createTerminal(cwd, label),
  )
  ipcMain.handle(IPC_QUERY_CHANNEL, (_event, name: string, payload: unknown) =>
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
  const unsubscribeEditorHost = editorHost.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(EDITOR_HOST_STATUS_CHANGED_CHANNEL, status)
    }
  })

  return () => {
    unsubscribe()
    unsubscribeEditorHost()
    ipcMain.removeHandler(GET_BACKEND_STATUS_CHANNEL)
    ipcMain.removeHandler(SYSTEM_PING_CHANNEL)
    ipcMain.removeHandler(GET_BACKEND_INFO_CHANNEL)
    ipcMain.removeHandler(RETRY_BACKEND_STARTUP_CHANNEL)
    ipcMain.removeHandler(PICK_PROJECT_DIRECTORY_CHANNEL)
    ipcMain.removeHandler(PICK_PROJECT_FILE_CHANNEL)
    ipcMain.removeHandler(SYNC_EDITOR_HOST_CHANNEL)
    ipcMain.removeHandler(GET_EDITOR_HOST_STATUS_CHANNEL)
    ipcMain.removeHandler(EDITOR_OPEN_FILE_CHANNEL)
    ipcMain.removeHandler(EDITOR_OPEN_TERMINAL_CHANNEL)
    ipcMain.removeHandler(IPC_QUERY_CHANNEL)
    ipcMain.removeHandler(IPC_COMMAND_CHANNEL)
  }
}
