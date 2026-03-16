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

  it("registers a retry-startup IPC method on the desktop bridge", async () => {
    const connection = {
      getStatus: vi.fn(() => ({ phase: "running" })),
      ping: vi.fn(),
      getBackendInfo: vi.fn(),
      retryStartup: vi.fn(async () => ({ phase: "starting" })),
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    }

    const unregister = registerShellIpc(connection as never)

    await handlers.get("ultra-shell:retry-backend-startup")?.()

    expect(connection.retryStartup).toHaveBeenCalledOnce()

    unregister()
  })

  it("bridges backend subscriptions to renderer events and supports unsubscribe", async () => {
    const sender = {
      id: 99,
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
    }
    const unsubscribe = vi.fn()
    let onEvent: ((event: unknown) => void) | null = null
    const connection = {
      getStatus: vi.fn(() => ({ phase: "running" })),
      ping: vi.fn(),
      getBackendInfo: vi.fn(),
      retryStartup: vi.fn(),
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      subscribeToIpc: vi.fn(
        async (
          _name: string,
          _payload: unknown,
          listener: (event: unknown) => void,
        ) => {
          onEvent = listener
          return {
            subscriptionId: "sub_terminal_sessions",
            unsubscribe,
          }
        },
      ),
    }

    const unregister = registerShellIpc(connection as never)
    const subscribeResult = await handlers.get("ultra-shell:ipc-subscribe")?.(
      { sender },
      "terminal.sessions",
      { project_id: "proj_1" },
    )

    expect(connection.subscribeToIpc).toHaveBeenCalledWith(
      "terminal.sessions",
      { project_id: "proj_1" },
      expect.any(Function),
    )
    expect(subscribeResult).toEqual({ subscriptionId: "sub_terminal_sessions" })

    onEvent?.({
      protocol_version: "1.0",
      type: "event",
      subscription_id: "sub_terminal_sessions",
      event_name: "terminal.sessions",
      payload: {
        project_id: "proj_1",
        sessions: [],
      },
    })

    expect(sender.send).toHaveBeenCalledWith(
      "ultra-shell:ipc-subscription-event",
      expect.objectContaining({
        subscription_id: "sub_terminal_sessions",
      }),
    )

    await handlers.get("ultra-shell:ipc-unsubscribe")?.(
      { sender },
      "sub_terminal_sessions",
    )

    expect(unsubscribe).toHaveBeenCalledOnce()

    unregister()
  })
})
