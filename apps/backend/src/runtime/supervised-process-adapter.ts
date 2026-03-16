import type {
  ProjectId,
  RuntimeComponentScope,
  RuntimeComponentType,
  RuntimeDetails,
} from "@ultra/shared"

export type SupervisedProcessSpec = {
  componentType: RuntimeComponentType
  scope: RuntimeComponentScope
  projectId?: ProjectId | null
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  details?: RuntimeDetails | null
}

export type SupervisedProcessExit = {
  code: number | null
  signal: NodeJS.Signals | null
  error?: string | null
}

export type SupervisedProcessExitListener = (
  event: SupervisedProcessExit,
) => void

export interface SupervisedProcessHandle {
  readonly pid: number | null
  kill(signal?: NodeJS.Signals): void
  onExit(listener: SupervisedProcessExitListener): () => void
}

export interface SupervisedProcessAdapter {
  spawn(spec: SupervisedProcessSpec): SupervisedProcessHandle
}
