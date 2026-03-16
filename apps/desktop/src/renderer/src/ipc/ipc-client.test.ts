import { beforeEach, describe, expect, it, vi } from "vitest"

import { ipcClient } from "./ipc-client.js"

describe("ipcClient.subscribe", () => {
  const subscriptionListeners = new Set<(event: unknown) => void>()

  beforeEach(() => {
    subscriptionListeners.clear()
    const ultraShell = {
      appName: "Ultra",
      chromeVersion: "1",
      electronVersion: "1",
      nodeVersion: "1",
      getBackendStatus: vi.fn(),
      pingBackend: vi.fn(),
      getBackendInfo: vi.fn(),
      retryBackendStartup: vi.fn(),
      pickProjectDirectory: vi.fn(),
      ipcQuery: vi.fn(),
      ipcCommand: vi.fn(),
      ipcSubscribe: vi.fn(async () => ({ subscriptionId: "sub_terminal" })),
      ipcUnsubscribe: vi.fn(async () => undefined),
      onIpcSubscriptionEvent: vi.fn((listener: (event: unknown) => void) => {
        subscriptionListeners.add(listener)
        return () => {
          subscriptionListeners.delete(listener)
        }
      }),
      onBackendStatusChange: vi.fn(),
      onOpenSystemTools: vi.fn(),
    }

    Object.assign(globalThis, {
      window: {
        ultraShell,
      },
    })
  })

  it("filters subscription events by subscription id", async () => {
    const listener = vi.fn()
    const unsubscribe = await ipcClient.subscribe(
      "terminal.sessions",
      { project_id: "proj_1" },
      listener,
    )

    for (const subscriptionListener of subscriptionListeners) {
      subscriptionListener({
        protocol_version: "1.0",
        type: "event",
        subscription_id: "sub_other",
        event_name: "terminal.sessions",
        payload: {
          project_id: "proj_1",
          sessions: [],
        },
      })
      subscriptionListener({
        protocol_version: "1.0",
        type: "event",
        subscription_id: "sub_terminal",
        event_name: "terminal.sessions",
        payload: {
          project_id: "proj_1",
          sessions: [],
        },
      })
    }

    expect(listener).toHaveBeenCalledTimes(1)

    await unsubscribe()

    expect(globalThis.window.ultraShell.ipcUnsubscribe).toHaveBeenCalledWith(
      "sub_terminal",
    )
  })
})
