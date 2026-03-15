import { beforeEach, describe, expect, it, vi } from "vitest"

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      },
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  },
}))

import { registerShellIpc } from "./ipc-shell.js"

describe("registerShellIpc", () => {
  beforeEach(() => {
    handlers.clear()
  })

  it("registers generic query and command IPC methods on the desktop bridge", async () => {
    const connection = {
      getStatus: vi.fn(() => ({ phase: "running" })),
      ping: vi.fn(),
      getBackendInfo: vi.fn(),
      query: vi.fn(async (name: string, payload: unknown) => ({
        name,
        payload,
      })),
      command: vi.fn(async (name: string, payload: unknown) => ({
        name,
        payload,
      })),
      subscribe: vi.fn(() => () => undefined),
    }

    const unregister = registerShellIpc(connection as never)

    await handlers.get("ultra-shell:ipc-command")?.({}, "projects.open", {
      path: "/tmp/project",
    })
    await handlers.get("ultra-shell:ipc-query")?.({}, "projects.get", {
      project_id: "proj_1",
    })

    expect(connection.command).toHaveBeenCalledWith("projects.open", {
      path: "/tmp/project",
    })
    expect(connection.query).toHaveBeenCalledWith("projects.get", {
      project_id: "proj_1",
    })

    unregister()
  })
})
