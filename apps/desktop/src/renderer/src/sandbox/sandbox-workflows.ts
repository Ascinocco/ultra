import {
  parseSandboxContextSnapshot,
  parseSandboxesListResult,
} from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command">

export async function hydrateSandboxes(
  projectId: string,
  actions: Pick<AppActions, "setSandboxes" | "setActiveSandbox" | "setSandboxFetchStatus">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  actions.setSandboxFetchStatus("loading")

  try {
    const [listResult, activeResult] = await Promise.all([
      client.query("sandboxes.list", { project_id: projectId }),
      client.query("sandboxes.get_active", { project_id: projectId }),
    ])

    const { sandboxes } = parseSandboxesListResult(listResult)
    const activeSandbox = parseSandboxContextSnapshot(activeResult)

    actions.setSandboxes(sandboxes)
    actions.setActiveSandbox(activeSandbox)
    actions.setSandboxFetchStatus("idle")
  } catch {
    actions.setSandboxFetchStatus("error")
  }
}

export async function switchSandbox(
  projectId: string,
  sandboxId: string,
  actions: Pick<AppActions, "setActiveSandbox">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.command("sandboxes.set_active", {
    project_id: projectId,
    sandbox_id: sandboxId,
  })

  const sandbox = parseSandboxContextSnapshot(result)
  actions.setActiveSandbox(sandbox)
}
