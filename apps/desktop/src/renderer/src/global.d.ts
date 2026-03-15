import type { BackendInfoSnapshot, SystemPingResult } from "@ultra/shared"
import type {
  BackendStatusListener,
  BackendStatusSnapshot,
} from "../../shared/backend-status.js"

declare global {
  interface Window {
    ultraShell: {
      appName: string
      chromeVersion: string
      electronVersion: string
      nodeVersion: string
      getBackendStatus: () => Promise<BackendStatusSnapshot>
      pingBackend: () => Promise<SystemPingResult>
      getBackendInfo: () => Promise<BackendInfoSnapshot>
      ipcQuery: (name: string, payload?: unknown) => Promise<unknown>
      ipcCommand: (name: string, payload?: unknown) => Promise<unknown>
      onBackendStatusChange: (listener: BackendStatusListener) => () => void
    }
  }
}
