import type { BackendInfoSnapshot, SystemPingResult } from "@ultra/shared"
import type {
  BackendStatusListener,
  BackendStatusSnapshot,
} from "../../shared/backend-status.js"
import type {
  EditorHostStatusListener,
  EditorHostStatusSnapshot,
} from "../../shared/editor-host.js"

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
      pickProjectFile: (rootPath?: string | null) => Promise<string | null>
      syncEditorHost: (payload: unknown) => Promise<EditorHostStatusSnapshot>
      getEditorHostStatus: () => Promise<EditorHostStatusSnapshot>
      openEditorFile: (path: string) => Promise<void>
      openEditorTerminal: (cwd: string, label?: string) => Promise<void>
      ipcQuery: (name: string, payload?: unknown) => Promise<unknown>
      ipcCommand: (name: string, payload?: unknown) => Promise<unknown>
      onBackendStatusChange: (listener: BackendStatusListener) => () => void
      onOpenSystemTools: (listener: () => void) => () => void
      onEditorHostStatusChange: (
        listener: EditorHostStatusListener,
      ) => () => void
    }
  }
}
