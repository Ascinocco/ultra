import { describe, expect, it, vi } from "vitest"

import { EditorWorkspaceHost } from "./editor-workspace-host.js"

describe("EditorWorkspaceHost", () => {
  it("creates and attaches only one view while visible", async () => {
    const addChildView = vi.fn()
    const removeChildView = vi.fn()
    const setBounds = vi.fn()
    const setVisible = vi.fn()
    const loadURL = vi.fn(async () => undefined)
    const focus = vi.fn()
    const sendInputEvent = vi.fn()
    const server = {
      ensureRunning: vi.fn(async () => "http://127.0.0.1:4010"),
      stop: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (status: unknown) => void) => {
        listener({
          phase: "idle",
          message: "idle",
          workspacePath: null,
          serverUrl: null,
        })
        return () => undefined
      }),
    }

    const host = new EditorWorkspaceHost(server as never, console, () => ({
      setBounds,
      setVisible,
      webContents: {
        loadURL,
        focus,
        sendInputEvent,
      },
    }))

    host.attachToWindow({
      contentView: { addChildView, removeChildView },
    } as never)

    await host.sync({
      visible: true,
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      workspacePath: "/tmp/project",
    })
    await host.sync({
      visible: true,
      bounds: { x: 12, y: 24, width: 320, height: 220 },
      workspacePath: "/tmp/project",
    })

    expect(addChildView).toHaveBeenCalledTimes(1)
    expect(setBounds).toHaveBeenCalledWith({
      x: 12,
      y: 24,
      width: 320,
      height: 220,
    })
    expect(loadURL).toHaveBeenCalledTimes(1)
  })

  it("detaches the child view when hidden", async () => {
    const addChildView = vi.fn()
    const removeChildView = vi.fn()
    const server = {
      ensureRunning: vi.fn(async () => "http://127.0.0.1:4010"),
      stop: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (status: unknown) => void) => {
        listener({
          phase: "idle",
          message: "idle",
          workspacePath: null,
          serverUrl: null,
        })
        return () => undefined
      }),
    }

    const host = new EditorWorkspaceHost(server as never, console, () => ({
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        loadURL: vi.fn(async () => undefined),
        focus: vi.fn(),
        sendInputEvent: vi.fn(),
      },
    }))

    host.attachToWindow({
      contentView: { addChildView, removeChildView },
    } as never)

    await host.sync({
      visible: true,
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      workspacePath: "/tmp/project",
    })

    await host.sync({
      visible: false,
      bounds: null,
      workspacePath: null,
    })

    expect(removeChildView).toHaveBeenCalledTimes(1)
  })

  it("does not create a view without an active project", async () => {
    const addChildView = vi.fn()
    const server = {
      ensureRunning: vi.fn(async () => "http://127.0.0.1:4010"),
      stop: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (status: unknown) => void) => {
        listener({
          phase: "idle",
          message: "idle",
          workspacePath: null,
          serverUrl: null,
        })
        return () => undefined
      }),
    }

    const host = new EditorWorkspaceHost(server as never)
    host.attachToWindow({
      contentView: { addChildView, removeChildView: vi.fn() },
    } as never)

    await host.sync({
      visible: true,
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      workspacePath: null,
    })

    expect(addChildView).not.toHaveBeenCalled()
    expect(server.ensureRunning).not.toHaveBeenCalled()
  })

  it("uses the embedded workbench to open a file and terminal", async () => {
    const sendInputEvent = vi.fn()
    const server = {
      ensureRunning: vi.fn(async () => "http://127.0.0.1:4010"),
      stop: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (status: unknown) => void) => {
        listener({
          phase: "ready",
          message: "ready",
          workspacePath: "/tmp/project",
          serverUrl: "http://127.0.0.1:4010",
        })
        return () => undefined
      }),
    }

    const host = new EditorWorkspaceHost(server as never, console, () => ({
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        loadURL: vi.fn(async () => undefined),
        focus: vi.fn(),
        sendInputEvent,
      },
    }))

    host.attachToWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as never)

    await host.sync({
      visible: true,
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      workspacePath: "/tmp/project",
    })

    await host.openFile("/tmp/project/src/App.tsx")
    await host.createTerminal("/tmp/project", "Project terminal")

    expect(sendInputEvent).toHaveBeenCalled()
  })
})
