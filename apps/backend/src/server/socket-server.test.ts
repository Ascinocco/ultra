import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IPC_PROTOCOL_VERSION, parseIpcResponseEnvelope } from "@ultra/shared"
import { describe, expect, it } from "vitest"

import { bootstrapDatabase } from "../db/database.js"
import { ProjectService } from "../projects/project-service.js"
import { startSocketServer } from "./socket-server.js"

async function createServerRuntime(directory: string, socketPath: string) {
  const databaseRuntime = bootstrapDatabase({
    ULTRA_DB_PATH: join(directory, "ultra.db"),
  })
  const runtime = await startSocketServer(
    socketPath,
    {
      projectService: new ProjectService(databaseRuntime.database),
    },
    {
      info: () => undefined,
      error: () => undefined,
    },
  )

  return {
    runtime,
    databaseRuntime,
  }
}

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
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

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
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("returns an explicit unsupported protocol error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

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
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("handles system.ping", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

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
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips environment readiness queries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )

    const rawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_readiness",
      type: "query",
      name: "system.get_environment_readiness",
      payload: {},
    })
    const response = parseIpcResponseEnvelope(rawResponse)

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result).toMatchObject({
        status: expect.any(String),
        checks: expect.any(Array),
      })
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })

  it("round-trips projects.open, projects.get, and projects.list", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ultra-ipc-"))
    const socketPath = join(directory, "backend.sock")
    const projectDirectory = join(directory, "repo")
    const { runtime, databaseRuntime } = await createServerRuntime(
      directory,
      socketPath,
    )
    await mkdir(projectDirectory, { recursive: true })

    const openRawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_open",
      type: "command",
      name: "projects.open",
      payload: {
        path: projectDirectory,
      },
    })
    const openResponse = parseIpcResponseEnvelope(openRawResponse)

    expect(openResponse.ok).toBe(true)
    if (!openResponse.ok) {
      throw new Error("Expected open response to succeed")
    }

    const getRawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_get",
      type: "query",
      name: "projects.get",
      payload: {
        project_id: openResponse.result.id,
      },
    })
    const listRawResponse = await request(socketPath, {
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_list",
      type: "query",
      name: "projects.list",
      payload: {},
    })
    const getResponse = parseIpcResponseEnvelope(getRawResponse)
    const listResponse = parseIpcResponseEnvelope(listRawResponse)

    expect(getResponse.ok).toBe(true)
    expect(listResponse.ok).toBe(true)

    if (getResponse.ok) {
      expect(getResponse.result.id).toBe(openResponse.result.id)
    }

    if (listResponse.ok) {
      expect(listResponse.result.projects).toHaveLength(1)
    }

    await runtime.close()
    databaseRuntime.close()
    await rm(directory, { recursive: true, force: true })
  })
})
