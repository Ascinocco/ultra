import { createConnection } from "node:net"

import type {
  CommandMethodName,
  IpcResponseEnvelope,
  QueryMethodName,
} from "@ultra/shared"
import { IPC_PROTOCOL_VERSION, parseIpcResponseEnvelope } from "@ultra/shared"

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

export class BackendSocketClient {
  constructor(
    private readonly socketPath: string,
    private readonly logger: Logger = console,
    private readonly timeoutMs = 1_500,
  ) {}

  async query(
    name: QueryMethodName,
    payload: unknown = {},
  ): Promise<IpcResponseEnvelope> {
    return this.sendRequest("query", name, payload)
  }

  async command(
    name: CommandMethodName,
    payload: unknown = {},
  ): Promise<IpcResponseEnvelope> {
    return this.sendRequest("command", name, payload)
  }

  private async sendRequest(
    type: "query" | "command",
    name: string,
    payload: unknown,
  ): Promise<IpcResponseEnvelope> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath)
      let buffer = ""
      let settled = false

      const timeout = setTimeout(() => {
        if (settled) {
          return
        }

        settled = true
        socket.destroy()
        reject(new Error(`Backend request timed out: ${name}`))
      }, this.timeoutMs)

      const finish = (callback: () => void) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        callback()
      }

      socket.setEncoding("utf8")
      socket.once("error", (error) => {
        finish(() => {
          reject(error)
        })
      })
      socket.on("data", (chunk) => {
        buffer += chunk

        if (!buffer.includes("\n")) {
          return
        }

        const line = buffer.slice(0, buffer.indexOf("\n")).trim()

        finish(() => {
          try {
            const response = parseIpcResponseEnvelope(JSON.parse(line))

            this.logger.info(
              `[desktop] received response ${response.request_id}`,
            )
            socket.end()
            resolve(response)
          } catch (error) {
            reject(error)
          }
        })
      })
      socket.once("connect", () => {
        this.logger.info(
          `[desktop] connected to backend socket ${this.socketPath}`,
        )
        socket.write(
          `${JSON.stringify({
            protocol_version: IPC_PROTOCOL_VERSION,
            request_id: requestId,
            type,
            name,
            payload,
          })}\n`,
        )
      })
    })
  }
}
