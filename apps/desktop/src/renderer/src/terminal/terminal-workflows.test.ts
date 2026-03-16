import { describe, expect, it, vi } from "vitest"

import { makeTerminalSession } from "../test-utils/factories.js"
import {
  closeTerminalSession,
  openTerminal,
  pinTerminalSession,
  renameTerminalSession,
  resizeTerminalSession,
  writeTerminalInput,
} from "./terminal-workflows.js"

const session = makeTerminalSession("term-1", "proj-1", "sb-1")

describe("openTerminal", () => {
  it("calls terminal.open and upserts the returned session", async () => {
    const actions = {
      upsertTerminalSession: vi.fn(),
      setFocusedTerminalSession: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
    }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(session),
    }

    const result = await openTerminal("proj-1", actions, client)

    expect(client.command).toHaveBeenCalledWith("terminal.open", {
      project_id: "proj-1",
    })
    expect(actions.upsertTerminalSession).toHaveBeenCalledWith("proj-1", session)
    expect(actions.setFocusedTerminalSession).toHaveBeenCalledWith(
      "proj-1",
      "term-1",
    )
    expect(actions.setTerminalDrawerOpen).toHaveBeenCalledWith("proj-1", true)
    expect(result).toEqual(session)
  })

  it("passes cols and rows when provided", async () => {
    const actions = {
      upsertTerminalSession: vi.fn(),
      setFocusedTerminalSession: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
    }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(session),
    }

    await openTerminal("proj-1", actions, client, { cols: 80, rows: 24 })

    expect(client.command).toHaveBeenCalledWith("terminal.open", {
      project_id: "proj-1",
      cols: 80,
      rows: 24,
    })
  })

  it("does not open drawer on error", async () => {
    const actions = {
      upsertTerminalSession: vi.fn(),
      setFocusedTerminalSession: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
    }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockRejectedValue(new Error("backend down")),
    }

    await expect(openTerminal("proj-1", actions, client)).rejects.toThrow(
      "backend down",
    )
    expect(actions.setTerminalDrawerOpen).not.toHaveBeenCalled()
  })
})

describe("closeTerminalSession", () => {
  it("calls close_session and refreshes session list", async () => {
    const remaining = [makeTerminalSession("term-2", "proj-1", "sb-1")]
    const actions = {
      setTerminalSessionsForProject: vi.fn(),
    }
    const client = {
      query: vi.fn().mockResolvedValue({ sessions: remaining }),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await closeTerminalSession("proj-1", "term-1", actions, client)

    expect(client.command).toHaveBeenCalledWith("terminal.close_session", {
      project_id: "proj-1",
      session_id: "term-1",
    })
    expect(client.query).toHaveBeenCalledWith("terminal.list_sessions", {
      project_id: "proj-1",
    })
    expect(actions.setTerminalSessionsForProject).toHaveBeenCalledWith(
      "proj-1",
      remaining,
    )
  })
})

describe("writeTerminalInput", () => {
  it("sends input to the backend", async () => {
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await writeTerminalInput("proj-1", "term-1", "ls\n", client)

    expect(client.command).toHaveBeenCalledWith("terminal.write_input", {
      project_id: "proj-1",
      session_id: "term-1",
      input: "ls\n",
    })
  })
})

describe("resizeTerminalSession", () => {
  it("sends resize to the backend", async () => {
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(undefined),
    }

    await resizeTerminalSession("proj-1", "term-1", 120, 40, client)

    expect(client.command).toHaveBeenCalledWith("terminal.resize_session", {
      project_id: "proj-1",
      session_id: "term-1",
      cols: 120,
      rows: 40,
    })
  })
})

describe("renameTerminalSession", () => {
  it("calls terminal.rename_session and upserts the returned session", async () => {
    const renamed = makeTerminalSession("term-1", "proj-1", "sb-1", {
      displayName: "My Shell",
    })
    const actions = { upsertTerminalSession: vi.fn() }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(renamed),
    }

    await renameTerminalSession("proj-1", "term-1", "My Shell", actions, client)

    expect(client.command).toHaveBeenCalledWith("terminal.rename_session", {
      project_id: "proj-1",
      session_id: "term-1",
      display_name: "My Shell",
    })
    expect(actions.upsertTerminalSession).toHaveBeenCalledWith("proj-1", renamed)
  })
})

describe("pinTerminalSession", () => {
  it("calls terminal.pin_session and upserts the returned session", async () => {
    const pinned = makeTerminalSession("term-1", "proj-1", "sb-1", {
      pinned: true,
    })
    const actions = { upsertTerminalSession: vi.fn() }
    const client = {
      query: vi.fn(),
      command: vi.fn().mockResolvedValue(pinned),
    }

    await pinTerminalSession("proj-1", "term-1", true, actions, client)

    expect(client.command).toHaveBeenCalledWith("terminal.pin_session", {
      project_id: "proj-1",
      session_id: "term-1",
      pinned: true,
    })
    expect(actions.upsertTerminalSession).toHaveBeenCalledWith("proj-1", pinned)
  })
})
