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

function createEditorHostMock() {
  return {
    sync: vi.fn(async () => ({ phase: "idle", message: "idle" })),
    getStatus: vi.fn(() => ({ phase: "idle", message: "idle" })),
    openFile: vi.fn(async () => undefined),
    createTerminal: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  }
}

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

    const unregister = registerShellIpc(
      connection as never,
      createEditorHostMock() as never,
    )

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

    const unregister = registerShellIpc(
      connection as never,
      createEditorHostMock() as never,
    )
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

  it("registers editor host controls on the desktop bridge", async () => {
    const connection = {
      getStatus: vi.fn(() => ({ phase: "running" })),
      ping: vi.fn(),
      getBackendInfo: vi.fn(),
      retryStartup: vi.fn(),
      query: vi.fn(),
      command: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    }
    const editorHost = {
      sync: vi.fn(async () => ({ phase: "ready", message: "ready" })),
      getStatus: vi.fn(() => ({ phase: "idle", message: "idle" })),
      openFile: vi.fn(async () => undefined),
      createTerminal: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
    }

    const unregister = registerShellIpc(
      connection as never,
      editorHost as never,
    )

    await handlers.get("ultra-shell:sync-editor-host")?.(
      {},
      { visible: true, bounds: { x: 0, y: 0, width: 100, height: 100 } },
    )
    await handlers.get("ultra-shell:editor-open-file")?.({}, "/tmp/file.ts")
    await handlers.get("ultra-shell:editor-open-terminal")?.(
      {},
      "/tmp/project",
      "Project terminal",
    )
    await handlers.get("ultra-shell:get-editor-host-status")?.()

    expect(editorHost.sync).toHaveBeenCalled()
    expect(editorHost.openFile).toHaveBeenCalledWith("/tmp/file.ts")
    expect(editorHost.createTerminal).toHaveBeenCalledWith(
      "/tmp/project",
      "Project terminal",
    )
    expect(editorHost.getStatus).toHaveBeenCalledOnce()

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

    const unregister = registerShellIpc(
      connection as never,
      {
        sync: vi.fn(),
        getStatus: vi.fn(),
        openFile: vi.fn(),
        createTerminal: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      } as never,
    )

    await handlers.get("ultra-shell:retry-backend-startup")?.()

    expect(connection.retryStartup).toHaveBeenCalledOnce()

    unregister()
  })
})
