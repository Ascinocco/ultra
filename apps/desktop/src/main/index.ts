import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"
import { app, BrowserWindow, Menu } from "electron"

import {
  createApplicationMenuTemplate,
  OPEN_SYSTEM_TOOLS_CHANNEL,
} from "./app-menu.js"
import { createBackendLaunchConfig } from "./backend-config.js"
import { BackendConnection } from "./backend-connection.js"
import { BackendProcessManager } from "./backend-process.js"
import { CodeOssServer } from "./code-oss-server.js"
import { EditorWorkspaceHost } from "./editor-workspace-host.js"
import { registerShellIpc } from "./ipc-shell.js"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const backendManager = new BackendProcessManager({
  config: createBackendLaunchConfig(app),
})
const backendConnection = new BackendConnection(backendManager)
const codeOssServer = new CodeOssServer({
  repoRoot,
  runtimeDir: resolve(app.getPath("userData"), "desktop-runtime"),
})
const editorHost = new EditorWorkspaceHost(codeOssServer)

let unregisterShellIpc: (() => void) | null = null
let isQuitting = false

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 12 },
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

  editorHost.attachToWindow(mainWindow)

  return mainWindow
}

function openSystemTools(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(OPEN_SYSTEM_TOOLS_CHANNEL)
  }
}

app.whenReady().then(() => {
  unregisterShellIpc = registerShellIpc(backendConnection, editorHost)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate(APP_NAME, openSystemTools),
    ),
  )
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

  void Promise.all([backendManager.stop(), editorHost.stop()]).finally(() => {
    unregisterShellIpc?.()
    app.exit(0)
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
