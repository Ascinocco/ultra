import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"
import { app, BrowserWindow } from "electron"

import { createBackendLaunchConfig } from "./backend-config.js"
import { BackendProcessManager } from "./backend-process.js"
import { registerShellIpc } from "./ipc-shell.js"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const backendManager = new BackendProcessManager({
  config: createBackendLaunchConfig(app),
})

let unregisterShellIpc: (() => void) | null = null
let isQuitting = false

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    title: buildPlaceholderProjectLabel(APP_NAME),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }

  return mainWindow
}

app.whenReady().then(() => {
  unregisterShellIpc = registerShellIpc(backendManager)
  backendManager.start()
  createMainWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on("before-quit", (event) => {
  if (isQuitting) {
    return
  }

  isQuitting = true
  event.preventDefault()

  void backendManager.stop().finally(() => {
    unregisterShellIpc?.()
    app.exit(0)
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
