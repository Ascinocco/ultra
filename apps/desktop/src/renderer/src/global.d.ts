import type {
  BackendInfoSnapshot,
  SubscriptionEventEnvelope,
  SystemPingResult,
} from "@ultra/shared"
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
      retryBackendStartup: () => Promise<BackendStatusSnapshot>
      pickProjectDirectory: () => Promise<string | null>
      ipcQuery: (name: string, payload?: unknown) => Promise<unknown>
      ipcCommand: (name: string, payload?: unknown) => Promise<unknown>
      ipcSubscribe: (
        name: string,
        payload?: unknown,
      ) => Promise<{ subscriptionId: string }>
      ipcUnsubscribe: (subscriptionId: string) => Promise<void>
      onIpcSubscriptionEvent: (
        listener: (event: SubscriptionEventEnvelope) => void,
      ) => () => void
      onBackendStatusChange: (listener: BackendStatusListener) => () => void
      onOpenSystemTools: (listener: () => void) => () => void
    }
  }
}
