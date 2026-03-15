import { beforeEach, describe, expect, it, vi } from "vitest"

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const { fallbackWindow, focusedWindow, showOpenDialog } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  focusedWindow: { id: 1 },
  fallbackWindow: { id: 2 },
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [fallbackWindow],
    getFocusedWindow: () => focusedWindow,
  },
  dialog: {
    showOpenDialog,
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
    showOpenDialog.mockReset()
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

  it("registers a project-directory picker on the desktop bridge", async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/ultra-project"],
    })

    const connection = {
      getStatus: vi.fn(() => ({ phase: "running" })),
      ping: vi.fn(),
      getBackendInfo: vi.fn(),
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    }

    const unregister = registerShellIpc(connection as never)
    const result = await handlers.get("ultra-shell:pick-project-directory")?.()

    expect(showOpenDialog).toHaveBeenCalledWith(
      focusedWindow,
      expect.objectContaining({
        title: "Open Project",
        properties: ["openDirectory"],
      }),
    )
    expect(result).toBe("/tmp/ultra-project")

    unregister()
  })
})
