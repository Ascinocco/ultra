import type { CommandMethodName, QueryMethodName } from "@ultra/shared"

export class IpcClient {
  async query<T = unknown>(
    name: QueryMethodName,
    payload?: unknown,
  ): Promise<T> {
    return window.ultraShell.ipcQuery(name, payload) as Promise<T>
  }

  async command<T = unknown>(
    name: CommandMethodName,
    payload?: unknown,
  ): Promise<T> {
    return window.ultraShell.ipcCommand(name, payload) as Promise<T>
  }
}

export const ipcClient = new IpcClient()
