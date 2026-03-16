import { parseTerminalOutputEvent } from "@ultra/shared"

import { ipcClient } from "../ipc/ipc-client.js"
import { terminalOutputEmitter } from "./terminal-output-emitter.js"

type SubscribeClient = Pick<typeof ipcClient, "subscribe">

export async function subscribeToTerminalOutput(
  projectId: string,
  sessionId: string,
  client: SubscribeClient = ipcClient,
): Promise<() => Promise<void>> {
  return client.subscribe(
    "terminal.output",
    { project_id: projectId, session_id: sessionId },
    (event) => {
      const parsed = parseTerminalOutputEvent(event)
      terminalOutputEmitter.emit(
        parsed.payload.session_id,
        parsed.payload.chunk,
      )
    },
  )
}
