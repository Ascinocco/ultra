import { describe, expect, it } from "vitest"

import { createBackendBanner, startBackendScaffold } from "./index.js"

describe("backend scaffold", () => {
  it("returns a stable placeholder banner", () => {
    expect(createBackendBanner()).toContain("Ultra backend scaffold ready")
  })

  it("starts a long-lived scaffold runtime with the socket path", () => {
    process.env.ULTRA_SOCKET_PATH = "/tmp/ultra-backend.sock"

    const runtime = startBackendScaffold()

    expect(runtime.socketPath).toBe("/tmp/ultra-backend.sock")

    runtime.stop()
    delete process.env.ULTRA_SOCKET_PATH
  })
})
