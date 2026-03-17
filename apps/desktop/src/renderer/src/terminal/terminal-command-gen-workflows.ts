import type { TerminalCommandGenEvent } from "@ultra/shared"
import { parseTerminalCommandGenEvent } from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import { writeTerminalInput } from "./terminal-workflows.js"

type SubscribeClient = Pick<typeof ipcClient, "subscribe">
type CommandClient = Pick<typeof ipcClient, "query" | "command">

export type CommandGenListener = (event: TerminalCommandGenEvent) => void

export async function generateCommand(
  opts: {
    projectId: string
    prompt: string
    cwd: string
    recentOutput: string
    provider: "claude" | "codex"
    model: string
    sessionId: string
  },
  listener: CommandGenListener,
  client: SubscribeClient = ipcClient,
): Promise<() => Promise<void>> {
  const unsubscribe = await client.subscribe(
    "terminal.generate_command",
    {
      project_id: opts.projectId,
      prompt: opts.prompt,
      cwd: opts.cwd,
      recent_output: opts.recentOutput,
      provider: opts.provider,
      model: opts.model,
      session_id: opts.sessionId,
    },
    (event) => {
      const parsed = parseTerminalCommandGenEvent(event.payload)
      listener(parsed)
    },
  )

  return unsubscribe
}

export async function injectCommand(
  projectId: string,
  sessionId: string,
  command: string,
  client: CommandClient = ipcClient,
): Promise<void> {
  await writeTerminalInput(projectId, sessionId, command, client)
}
