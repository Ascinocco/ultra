import { describe, expect, it, vi } from "vitest"

import { makeSandbox } from "../test-utils/factories.js"
import { hydrateSandboxes, switchSandbox } from "./sandbox-workflows.js"

const sb = makeSandbox("sb-1", "proj-1", { displayName: "main checkout" })

describe("hydrateSandboxes", () => {
  it("fetches sandbox list and active sandbox, then updates store", async () => {
    const actions = {
      setSandboxesForProject: vi.fn(),
      setActiveSandboxIdForProject: vi.fn(),
    }

    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ sandboxes: [sb] })
        .mockResolvedValueOnce(sb),
      command: vi.fn(),
    }

    await hydrateSandboxes("proj-1", actions, client)

    expect(client.query).toHaveBeenCalledWith("sandboxes.list", {
      project_id: "proj-1",
    })
    expect(client.query).toHaveBeenCalledWith("sandboxes.get_active", {
      project_id: "proj-1",
    })
    expect(actions.setSandboxesForProject).toHaveBeenCalledWith("proj-1", [sb])
    expect(actions.setActiveSandboxIdForProject).toHaveBeenCalledWith(
      "proj-1",
      "sb-1",
    )
  })
})

describe("switchSandbox", () => {
  it("calls set_active and updates store on success", async () => {
    const actions = {
      setActiveSandboxIdForProject: vi.fn(),
    }

    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(sb),
    }

    await switchSandbox("proj-1", "sb-1", actions, client)

    expect(client.command).toHaveBeenCalledWith("sandboxes.set_active", {
      project_id: "proj-1",
      sandbox_id: "sb-1",
    })
    expect(actions.setActiveSandboxIdForProject).toHaveBeenCalledWith(
      "proj-1",
      "sb-1",
    )
  })

  it("propagates errors from set_active", async () => {
    const actions = {
      setActiveSandboxIdForProject: vi.fn(),
    }

    const client = {
      query: vi.fn(),
      command: vi.fn().mockRejectedValue(new Error("network error")),
    }

    await expect(
      switchSandbox("proj-1", "sb-1", actions, client),
    ).rejects.toThrow("network error")
    expect(actions.setActiveSandboxIdForProject).not.toHaveBeenCalled()
  })
})
