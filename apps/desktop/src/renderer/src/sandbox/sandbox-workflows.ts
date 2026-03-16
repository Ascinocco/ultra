import {
  parseSandboxContextSnapshot,
  parseSandboxesListResult,
} from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import type { AppActions } from "../state/app-store.js"

type WorkflowClient = Pick<typeof ipcClient, "query" | "command">

export async function hydrateSandboxes(
  projectId: string,
  actions: Pick<
    AppActions,
    "setSandboxesForProject" | "setActiveSandboxIdForProject"
  >,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const [listResult, activeResult] = await Promise.all([
    client.query("sandboxes.list", { project_id: projectId }),
    client.query("sandboxes.get_active", { project_id: projectId }),
  ])

  const { sandboxes } = parseSandboxesListResult(listResult)
  const activeSandbox = parseSandboxContextSnapshot(activeResult)

  actions.setSandboxesForProject(projectId, sandboxes)
  actions.setActiveSandboxIdForProject(projectId, activeSandbox.sandboxId)
}

export async function switchSandbox(
  projectId: string,
  sandboxId: string,
  actions: Pick<AppActions, "setActiveSandboxIdForProject">,
  client: WorkflowClient = ipcClient,
): Promise<void> {
  const result = await client.command("sandboxes.set_active", {
    project_id: projectId,
    sandbox_id: sandboxId,
  })

  const sandbox = parseSandboxContextSnapshot(result)
  actions.setActiveSandboxIdForProject(projectId, sandbox.sandboxId)
}
