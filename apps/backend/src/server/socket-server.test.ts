import { mkdtemp, rm } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IPC_PROTOCOL_VERSION, parseIpcResponseEnvelope } from "@ultra/shared"
import { describe, expect, it } from "vitest"

import { startSocketServer } from "./socket-server.js"

async function request(
  socketPath: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""

    socket.setEncoding("utf8")
    socket.once("error", reject)
    socket.on("data", (chunk) => {
      buffer += chunk

      if (!buffer.includes("\n")) {
        return
      }

      const line = buffer.slice(0, buffer.indexOf("\n")).trim()
      socket.end()
      resolve(JSON.parse(line))
    })
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`)
    })
  })
}

describe("socket server", () => {
  it("round-trips system.hello over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const runtime = await startSocketServer(socketPath, {
      info: () => undefined,
      error: () => undefined,
    })

    const rawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_hello",
      type: "query",
      name: "system.hello",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result).toMatchObject({
        acceptedProtocolVersion: IPC_PROTOCOL_VERSION,
      })
    }

    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("returns an explicit unsupported protocol error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const runtime = await startSocketServer(socketPath, {
      info: () => undefined,
      error: () => undefined,
    })

    const rawResponse = await request(socketPath, {
      protocol_version: "0.9",
      request_id: "req_old",
      type: "query",
      name: "system.hello",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBe("unsupported_protocol_version")
    }

    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("handles system.ping", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const runtime = await startSocketServer(socketPath, {
      info: () => undefined,
      error: () => undefined,
    })

    const rawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_ping",
      type: "query",
      name: "system.ping",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result).toMatchObject({ status: "ok" })
    }

    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  })
})
