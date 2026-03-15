import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { createBackendBanner, startBackendScaffold } from "./index.js"

describe("backend scaffold", () => {
  it("returns a stable placeholder banner", () => {
    expect(createBackendBanner()).toContain("Ultra backend scaffold ready")
  })

  it("starts a backend runtime with the socket path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ultra-backend-runtime-"))

    process.env.ULTRA_SOCKET_PATH = join(directory, "ultra-backend.sock")
    process.env.ULTRA_DB_PATH = join(directory, "ultra.db")

    const runtime = await startBackendScaffold()

    expect(runtime.socketPath).toBe(process.env.ULTRA_SOCKET_PATH)
    expect(runtime.databasePath).toBe(process.env.ULTRA_DB_PATH)
    expect(runtime.runtimeRegistry.listGlobalRuntimeComponents()).toEqual([])

    await runtime.stop()
    delete process.env.ULTRA_SOCKET_PATH
    delete process.env.ULTRA_DB_PATH
    rmSync(directory, { recursive: true, force: true })
  })

  it("fails when the database path points to a directory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ultra-backend-invalid-db-"))

    process.env.ULTRA_SOCKET_PATH = join(directory, "ultra-backend.sock")
    process.env.ULTRA_DB_PATH = directory

    await expect(startBackendScaffold()).rejects.toThrow()

    delete process.env.ULTRA_SOCKET_PATH
    delete process.env.ULTRA_DB_PATH
    rmSync(directory, { recursive: true, force: true })
  })
})
