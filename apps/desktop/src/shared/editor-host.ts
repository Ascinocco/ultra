export type EditorHostRect = {
  x: number
  y: number
  width: number
  height: number
}

export type EditorHostSyncRequest = {
  visible: boolean
  bounds: EditorHostRect | null
  workspacePath: string | null
}

export type EditorHostStatusPhase =
  | "idle"
  | "starting"
  | "ready"
  | "unavailable"
  | "error"

export type EditorHostStatusSnapshot = {
  phase: EditorHostStatusPhase
  message: string
  workspacePath: string | null
  serverUrl: string | null
}

export type EditorHostStatusListener = (
  status: EditorHostStatusSnapshot,
) => void

export type EditorHostAdapter = {
  openWorkspace: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  openDiff: (leftPath: string, rightPath: string) => Promise<void>
  openChangedFiles: (paths: string[]) => Promise<void>
  createTerminal: (cwd: string, label?: string) => Promise<void>
  runDebug: (profileId?: string) => Promise<void>
}

export function createInitialEditorHostStatus(): EditorHostStatusSnapshot {
  return {
    phase: "idle",
    message: "Editor host idle.",
    workspacePath: null,
    serverUrl: null,
  }
}
