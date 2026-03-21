import type { TerminalSessionSnapshot } from "@ultra/shared"
import {
  parseTerminalListSessionsResult,
  parseTerminalSessionSnapshot,
} from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command">

type OpenTerminalActions = Pick<
  AppActions,
  | "upsertTerminalSession"
  | "setFocusedTerminalSession"
  | "setTerminalDrawerOpen"
>

type CloseTerminalActions = Pick<AppActions, "setTerminalSessionsForProject">

export async function openTerminal(
  projectId: string,
  actions: OpenTerminalActions,
  client: WorkflowClient = ipcClient,
  opts?: { cols?: number; rows?: number; forceNew?: boolean; sandboxId?: string },
): Promise<TerminalSessionSnapshot> {
  const payload: Record<string, unknown> = { project_id: projectId }
  if (opts?.cols) payload.cols = opts.cols
  if (opts?.rows) payload.rows = opts.rows
  if (opts?.forceNew) payload.force_new = true
  if (opts?.sandboxId) payload.sandbox_id = opts.sandboxId

  const result = await client.command("terminal.open", payload)
  const session = parseTerminalSessionSnapshot(result)

  actions.upsertTerminalSession(projectId, session)
  actions.setFocusedTerminalSession(projectId, session.sessionId)
  actions.setTerminalDrawerOpen(projectId, true)

  return session
}

export async function closeTerminalSession(
  projectId: string,
  sessionId: string,
  actions: CloseTerminalActions,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("terminal.close_session", {
    project_id: projectId,
    session_id: sessionId,
  })

  const result = await client.query("terminal.list_sessions", {
    project_id: projectId,
  })
  const { sessions } = parseTerminalListSessionsResult(result)
  actions.setTerminalSessionsForProject(projectId, sessions)
}

export async function writeTerminalInput(
  projectId: string,
  sessionId: string,
  input: string,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("terminal.write_input", {
    project_id: projectId,
    session_id: sessionId,
    input,
  })
}

export async function resizeTerminalSession(
  projectId: string,
  sessionId: string,
  cols: number,
  rows: number,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  await client.command("terminal.resize_session", {
    project_id: projectId,
    session_id: sessionId,
    cols,
    rows,
  })
}

type RenameTerminalActions = Pick<AppActions, "upsertTerminalSession">

export async function renameTerminalSession(
  projectId: string,
  sessionId: string,
  displayName: string | null,
  actions: RenameTerminalActions,
  client: WorkflowClient = ipcClient,
): Promise<TerminalSessionSnapshot> {
  const result = await client.command("terminal.rename_session", {
    project_id: projectId,
    session_id: sessionId,
    display_name: displayName,
  })
  const session = parseTerminalSessionSnapshot(result)
  actions.upsertTerminalSession(projectId, session)
  return session
}

type PinTerminalActions = Pick<AppActions, "upsertTerminalSession">

export async function pinTerminalSession(
  projectId: string,
  sessionId: string,
  pinned: boolean,
  actions: PinTerminalActions,
  client: WorkflowClient = ipcClient,
): Promise<TerminalSessionSnapshot> {
  const result = await client.command("terminal.pin_session", {
    project_id: projectId,
    session_id: sessionId,
    pinned,
  })
  const session = parseTerminalSessionSnapshot(result)
  actions.upsertTerminalSession(projectId, session)
  return session
}
