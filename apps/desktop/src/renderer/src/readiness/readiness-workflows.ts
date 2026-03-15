import type { EnvironmentReadinessSnapshot } from "@ultra/shared"
import { parseEnvironmentReadinessSnapshot } from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"

type ReadinessWorkflowClient = Pick<typeof ipcClient, "query" | "command">

export async function loadEnvironmentReadiness(
  client: ReadinessWorkflowClient = ipcClient,
): Promise<EnvironmentReadinessSnapshot> {
  const result = await client.query("system.get_environment_readiness", {})
  return parseEnvironmentReadinessSnapshot(result)
}

export async function recheckEnvironmentReadiness(
  client: ReadinessWorkflowClient = ipcClient,
): Promise<EnvironmentReadinessSnapshot> {
  const result = await client.command("system.recheck_environment", {})
  return parseEnvironmentReadinessSnapshot(result)
}
