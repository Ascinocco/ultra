import { describe, expect, it } from "vitest"

import {
  APP_NAME,
  buildPlaceholderProjectLabel,
  IPC_PROTOCOL_VERSION,
  parseCommandRequest,
  parseEnvironmentReadinessSnapshot,
  parseIpcResponseEnvelope,
  parseProjectLayoutState,
  parseProjectOpenInput,
  parseProjectSnapshot,
  parseProjectsListResult,
  parseQueryRequest,
  parseSystemHelloResult,
  projectLayoutStateSchema,
} from "./index.js"

describe("shared contracts", () => {
  it("exports the app name", () => {
    expect(APP_NAME).toBe("Ultra")
  })

  it("builds a stable placeholder label", () => {
    expect(buildPlaceholderProjectLabel("Demo")).toBe("Demo workspace")
  })

  it("parses a valid system.hello query envelope", () => {
    const query = parseQueryRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_123",
      type: "query",
      name: "system.hello",
      payload: {},
    })

    expect(query.name).toBe("system.hello")
  })

  it("rejects a query envelope with an unsupported protocol version", () => {
    expect(() =>
      parseQueryRequest({
        protocol_version: "0.9",
        request_id: "req_123",
        type: "query",
        name: "system.hello",
        payload: {},
      }),
    ).toThrow()
  })

  it("parses a valid command envelope for projects.open", () => {
    const command = parseCommandRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_234",
      type: "command",
      name: "projects.open",
      payload: {
        path: "/Users/tony/Projects/ultra",
      },
    })

    expect(command.name).toBe("projects.open")
  })

  it("parses the system hello result contract", () => {
    const result = parseSystemHelloResult({
      acceptedProtocolVersion: IPC_PROTOCOL_VERSION,
      backendVersion: "0.1.0",
      sessionId: "sess_123",
      capabilities: {
        supportsProjects: true,
        supportsLayoutPersistence: true,
        supportsSubscriptions: true,
        supportsBackendInfo: true,
      },
    })

    expect(result.capabilities.supportsProjects).toBe(true)
  })

  it("parses environment readiness snapshots", () => {
    const snapshot = parseEnvironmentReadinessSnapshot({
      status: "blocked",
      sessionMode: "desktop",
      checkedAt: "2026-03-15T00:00:00Z",
      checks: [
        {
          tool: "sd",
          displayName: "Seeds CLI",
          scope: "runtime-required",
          requiredInCurrentSession: true,
          status: "missing",
          detectedVersion: null,
          command: "sd --version",
          helpText: "Install Seeds and ensure `sd` is on PATH.",
        },
      ],
    })

    expect(snapshot.status).toBe("blocked")
    expect(snapshot.checks[0]?.tool).toBe("sd")
  })

  it("rejects malformed dependency readiness checks", () => {
    expect(() =>
      parseEnvironmentReadinessSnapshot({
        status: "blocked",
        sessionMode: "desktop",
        checkedAt: "2026-03-15T00:00:00Z",
        checks: [
          {
            tool: "seeds",
            displayName: "Seeds CLI",
            scope: "runtime-required",
            requiredInCurrentSession: true,
            status: "missing",
            detectedVersion: null,
            command: "sd --version",
            helpText: "Install Seeds and ensure `sd` is on PATH.",
          },
        ],
      }),
    ).toThrow()
  })

  it("parses project open input", () => {
    const input = parseProjectOpenInput({
      path: "/Users/tony/Projects/ultra",
    })

    expect(input.path).toContain("/Users/tony/Projects/ultra")
  })

  it("parses project snapshots", () => {
    const snapshot = parseProjectSnapshot({
      id: "proj_123",
      key: "/Users/tony/Projects/ultra",
      name: "Ultra",
      rootPath: "/Users/tony/Projects/ultra",
      gitRootPath: "/Users/tony/Projects/ultra",
      createdAt: "2026-03-14T12:00:00Z",
      updatedAt: "2026-03-14T12:00:00Z",
      lastOpenedAt: "2026-03-14T12:01:00Z",
    })

    expect(snapshot.name).toBe("Ultra")
  })

  it("parses project list results", () => {
    const result = parseProjectsListResult({
      projects: [
        {
          id: "proj_123",
          key: "/Users/tony/Projects/ultra",
          name: "Ultra",
          rootPath: "/Users/tony/Projects/ultra",
          gitRootPath: "/Users/tony/Projects/ultra",
          createdAt: "2026-03-14T12:00:00Z",
          updatedAt: "2026-03-14T12:00:00Z",
          lastOpenedAt: "2026-03-14T12:01:00Z",
        },
      ],
    })

    expect(result.projects).toHaveLength(1)
  })

  it("accepts the milestone one project layout state", () => {
    const layout = parseProjectLayoutState({
      currentPage: "chat",
      rightTopCollapsed: false,
      rightBottomCollapsed: true,
      selectedRightPaneTab: "threads",
      selectedBottomPaneTab: "runtime",
      activeChatId: "chat_123",
      selectedThreadId: "thread_123",
      lastEditorTargetId: "target_123",
    })

    expect(layout.currentPage).toBe("chat")
  })

  it("rejects malformed layout state", () => {
    expect(() =>
      projectLayoutStateSchema.parse({
        currentPage: "terminal",
        rightTopCollapsed: false,
        rightBottomCollapsed: true,
        selectedRightPaneTab: "threads",
        selectedBottomPaneTab: "runtime",
        activeChatId: null,
        selectedThreadId: null,
        lastEditorTargetId: null,
      }),
    ).toThrow()
  })

  it("parses typed error responses", () => {
    const response = parseIpcResponseEnvelope({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_999",
      type: "response",
      ok: false,
      error: {
        code: "invalid_request",
        message: "Missing payload",
      },
    })

    expect(response.ok).toBe(false)
  })
})
