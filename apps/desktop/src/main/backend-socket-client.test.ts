import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { IPC_PROTOCOL_VERSION } from "@ultra/shared"
import { describe, expect, it } from "vitest"

import { BackendSocketClient } from "./backend-socket-client.js"

type TestServer = {
  socketPath: string
  close: () => Promise<void>
}

async function createDelayedResponseServer(delayMs: number): Promise<TestServer> {
  const directory = await mkdtemp(join(tmpdir(), "ultra-desktop-socket-"))
  const socketPath = join(directory, "backend.sock")
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => {
      sockets.delete(socket)
    })

    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString()

      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n")
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)

        if (!line) {
          continue
        }

        const request = JSON.parse(line) as { request_id: string }
        setTimeout(() => {
          if (socket.destroyed) {
            return
          }

          socket.write(
            `${JSON.stringify({
              protocol_version: IPC_PROTOCOL_VERSION,
              request_id: request.request_id,
              type: "response",
              ok: true,
              result: {},
            })}\n`,
          )
        }, delayMs)
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error)
    }

    server.once("error", onError)
    server.listen(socketPath, () => {
      server.off("error", onError)
      resolve()
    })
  })

  return {
    socketPath,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy()
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
      await rm(directory, { recursive: true, force: true })
    },
  }
}

describe("BackendSocketClient", () => {
  it("allows chats.send_message to run longer than the default request timeout", async () => {
    const server = await createDelayedResponseServer(75)
    const client = new BackendSocketClient(
      server.socketPath,
      { info: () => undefined, error: () => undefined },
      20,
    )

    await expect(
      client.command("chats.send_message", {
        chat_id: "chat_1",
        prompt: "Ship the fix.",
      }),
    ).resolves.toMatchObject({ ok: true })

    await server.close()
  })

  it("keeps the default timeout for non-chat-turn commands", async () => {
    const server = await createDelayedResponseServer(75)
    const client = new BackendSocketClient(
      server.socketPath,
      { info: () => undefined, error: () => undefined },
      20,
    )

    await expect(
      client.command("chats.rename", {
        chat_id: "chat_1",
        title: "Renamed",
      }),
    ).rejects.toThrow("Backend request timed out: chats.rename")

    await server.close()
  })
})
