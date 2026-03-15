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
      onBackendStatusChange: (listener: BackendStatusListener) => () => void
    }
  }
}
