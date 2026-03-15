import { APP_NAME } from "@ultra/shared"
import { contextBridge } from "electron"

const ultraShell = {
  appName: APP_NAME,
  chromeVersion: process.versions.chrome,
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
}

contextBridge.exposeInMainWorld("ultraShell", ultraShell)
