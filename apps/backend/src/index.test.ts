import { describe, expect, it } from "vitest"

import { createBackendBanner, startBackendScaffold } from "./index.js"

describe("backend scaffold", () => {
  it("returns a stable placeholder banner", () => {
    expect(createBackendBanner()).toContain("Ultra backend scaffold ready")
  })

  it("starts a backend runtime with the socket path", async () => {
    process.env.ULTRA_SOCKET_PATH = "/tmp/ultra-backend.sock"

    const runtime = await startBackendScaffold()

    expect(runtime.socketPath).toBe("/tmp/ultra-backend.sock")

    await runtime.stop()
    delete process.env.ULTRA_SOCKET_PATH
  })
})
