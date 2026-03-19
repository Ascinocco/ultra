import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { IPC_PROTOCOL_VERSION, type IpcErrorCode } from "@ultra/shared"
import { describe, expect, it } from "vitest"

import { BackendSocketClient } from "./backend-socket-client.js"

type TestServer = {
  socketPath: string
  close: () => Promise<void>
}

type ScriptedRequest = {
  type: string
  name: string
  payload: unknown
}

type ScriptedStep = {
  name: string
  response:
    | {
        ok: true
        result: unknown
      }
    | {
        ok: false
        error: {
          code: IpcErrorCode
          message: string
        }
      }
  delayMs?: number
}

type ScriptedResponseServer = TestServer & {
  requests: ScriptedRequest[]
}

async function createDelayedResponseServer(
  delayMs: number,
): Promise<TestServer> {
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

async function createScriptedResponseServer(
  steps: ScriptedStep[],
): Promise<ScriptedResponseServer> {
  const directory = await mkdtemp(join(tmpdir(), "ultra-desktop-socket-"))
  const socketPath = join(directory, "backend.sock")
  const sockets = new Set<Socket>()
  const requests: ScriptedRequest[] = []
  const queue = [...steps]

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

        const request = JSON.parse(line) as {
          request_id: string
          type: string
          name: string
          payload: unknown
        }
        requests.push({
          type: request.type,
          name: request.name,
          payload: request.payload,
        })

        const next = queue.shift()
        const response =
          next && next.name === request.name
            ? next.response
            : ({
                ok: false,
                error: {
                  code: "internal_error",
                  message: `Unexpected request sequence for ${request.name}`,
                },
              } satisfies ScriptedStep["response"])

        setTimeout(() => {
          if (socket.destroyed) {
            return
          }

          socket.write(
            `${JSON.stringify({
              protocol_version: IPC_PROTOCOL_VERSION,
              request_id: request.request_id,
              type: "response",
              ...response,
            })}\n`,
          )
        }, next?.delayMs ?? 0)
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
    requests,
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
  it("handles chats.send_message through start_turn compatibility flow", async () => {
    const userMessage = {
      id: "chat_msg_user_1",
      chatId: "chat_1",
      sessionId: "chat_session_1",
      role: "user",
      messageType: "user_text",
      contentMarkdown: "Ship the fix.",
      structuredPayloadJson: null,
      providerMessageId: null,
      createdAt: "2026-03-19T12:00:00.000Z",
    }
    const assistantMessage = {
      id: "chat_msg_assistant_1",
      chatId: "chat_1",
      sessionId: "chat_session_1",
      role: "assistant",
      messageType: "assistant_text",
      contentMarkdown: "Done.",
      structuredPayloadJson: null,
      providerMessageId: "vendor_msg_1",
      createdAt: "2026-03-19T12:00:01.000Z",
    }
    const queuedTurn = {
      turnId: "chat_turn_1",
      chatId: "chat_1",
      sessionId: "chat_session_1",
      clientTurnId: "desktop_compat_turn_1",
      userMessageId: userMessage.id,
      assistantMessageId: null,
      status: "queued",
      provider: "claude",
      model: "claude-sonnet-4-6",
      vendorSessionId: null,
      startedAt: "2026-03-19T12:00:00.000Z",
      updatedAt: "2026-03-19T12:00:00.000Z",
      completedAt: null,
      failureCode: null,
      failureMessage: null,
      cancelRequestedAt: null,
    }
    const runningTurn = {
      ...queuedTurn,
      status: "running",
      updatedAt: "2026-03-19T12:00:01.000Z",
    }
    const succeededTurn = {
      ...queuedTurn,
      assistantMessageId: assistantMessage.id,
      status: "succeeded",
      vendorSessionId: "vendor_session_1",
      updatedAt: "2026-03-19T12:00:02.000Z",
      completedAt: "2026-03-19T12:00:02.000Z",
    }
    const turnCompletedEvent = {
      eventId: "chat_turn_event_2",
      chatId: "chat_1",
      turnId: "chat_turn_1",
      sequenceNumber: 2,
      eventType: "chat.turn_completed",
      source: "runtime",
      actorType: "system",
      actorId: null,
      payload: {
        assistant_message_id: assistantMessage.id,
        checkpoint_ids: ["chat_checkpoint_1"],
      },
      occurredAt: "2026-03-19T12:00:02.000Z",
      recordedAt: "2026-03-19T12:00:02.000Z",
    }

    const server = await createScriptedResponseServer([
      {
        name: "chats.start_turn",
        response: {
          ok: true,
          result: {
            accepted: true,
            turn: queuedTurn,
          },
        },
      },
      {
        name: "chats.get_turn",
        response: {
          ok: true,
          result: runningTurn,
        },
      },
      {
        name: "chats.get_turn",
        response: {
          ok: true,
          result: succeededTurn,
        },
      },
      {
        name: "chats.get_messages",
        response: {
          ok: true,
          result: {
            messages: [userMessage, assistantMessage],
          },
        },
      },
      {
        name: "chats.get_turn_events",
        response: {
          ok: true,
          result: {
            events: [turnCompletedEvent],
          },
        },
      },
    ])

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
    ).resolves.toMatchObject({
      ok: true,
      result: {
        userMessage,
        assistantMessage,
        checkpointIds: ["chat_checkpoint_1"],
      },
    })

    expect(server.requests.map((request) => request.name)).toEqual([
      "chats.start_turn",
      "chats.get_turn",
      "chats.get_turn",
      "chats.get_messages",
      "chats.get_turn_events",
    ])
    expect(
      server.requests.some((request) => request.name === "chats.send_message"),
    ).toBe(false)

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
