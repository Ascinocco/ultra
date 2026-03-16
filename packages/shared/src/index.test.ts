import { describe, expect, it } from "vitest"

import {
  APP_NAME,
  buildPlaceholderProjectLabel,
  IPC_PROTOCOL_VERSION,
  parseArtifactBundle,
  parseArtifactLoadResult,
  parseArtifactSnapshot,
  parseArtifactsCaptureRuntimeResult,
  parseChatSnapshot,
  parseChatsListResult,
  parseCommandRequest,
  parseEnvironmentReadinessSnapshot,
  parseIpcResponseEnvelope,
  parseProjectLayoutState,
  parseProjectOpenInput,
  parseProjectRuntimeHealthSummary,
  parseProjectRuntimeSnapshot,
  parseProjectSnapshot,
  parseProjectsListResult,
  parseQueryRequest,
  parseRuntimeComponentSnapshot,
  parseRuntimeHealthCheckSnapshot,
  parseSandboxesListResult,
  parseSavedCommandSnapshot,
  parseSubscribeRequest,
  parseSubscriptionEventEnvelope,
  parseSystemHelloResult,
  parseTerminalListSavedCommandsResult,
  parseTerminalListSessionsResult,
  parseTerminalOutputEvent,
  parseTerminalRuntimeProfileResult,
  parseTerminalSessionSnapshot,
  parseTerminalSessionsEvent,
  parseThreadDetailResult,
  parseThreadEventSnapshot,
  parseThreadsListResult,
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

  it("parses a valid command envelope for chats.create", () => {
    const command = parseCommandRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_chat_create",
      type: "command",
      name: "chats.create",
      payload: {
        project_id: "proj_123",
      },
    })

    expect(command.name).toBe("chats.create")
  })

  it("parses a valid command envelope for sandboxes.set_active", () => {
    const command = parseCommandRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_sandbox_set_active",
      type: "command",
      name: "sandboxes.set_active",
      payload: {
        project_id: "proj_123",
        sandbox_id: "sandbox_123",
      },
    })

    expect(command.name).toBe("sandboxes.set_active")
  })

  it("parses valid query envelopes for sandboxes.list and sandboxes.get_active", () => {
    const listQuery = parseQueryRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_sandbox_list",
      type: "query",
      name: "sandboxes.list",
      payload: {
        project_id: "proj_123",
      },
    })
    const activeQuery = parseQueryRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_sandbox_active",
      type: "query",
      name: "sandboxes.get_active",
      payload: {
        project_id: "proj_123",
      },
    })

    expect(listQuery.name).toBe("sandboxes.list")
    expect(activeQuery.name).toBe("sandboxes.get_active")
  })

  it("parses terminal runtime profile and sync envelopes", () => {
    const profileQuery = parseQueryRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_profile",
      type: "query",
      name: "terminal.get_runtime_profile",
      payload: {
        project_id: "proj_123",
      },
    })
    const syncCommand = parseCommandRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_sync",
      type: "command",
      name: "terminal.sync_runtime_files",
      payload: {
        project_id: "proj_123",
        sandbox_id: "sandbox_123",
        force: true,
      },
    })

    expect(profileQuery.name).toBe("terminal.get_runtime_profile")
    expect(syncCommand.name).toBe("terminal.sync_runtime_files")
  })

  it("parses terminal session commands, queries, and subscriptions", () => {
    const openCommand = parseCommandRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_open",
      type: "command",
      name: "terminal.open",
      payload: {
        project_id: "proj_123",
        cols: 120,
        rows: 30,
      },
    })
    const listSessionsQuery = parseQueryRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_list_sessions",
      type: "query",
      name: "terminal.list_sessions",
      payload: {
        project_id: "proj_123",
      },
    })
    const subscribeRequest = parseSubscribeRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_terminal_sessions_subscribe",
      type: "subscribe",
      name: "terminal.sessions",
      payload: {
        project_id: "proj_123",
      },
    })

    expect(openCommand.name).toBe("terminal.open")
    expect(listSessionsQuery.name).toBe("terminal.list_sessions")
    expect(subscribeRequest.name).toBe("terminal.sessions")
  })

  it("parses a valid command envelope for chats.start_thread", () => {
    const command = parseCommandRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_start_thread",
      type: "command",
      name: "chats.start_thread",
      payload: {
        chat_id: "chat_123",
        title: "Thread Title",
        summary: "Thread Summary",
        plan_approval_message_id: "msg_plan",
        spec_approval_message_id: "msg_spec",
        start_request_message_id: "msg_start",
        spec_refs: [],
        ticket_refs: [],
      },
    })

    expect(command.name).toBe("chats.start_thread")
  })

  it("parses a valid query envelope for threads.get_events", () => {
    const query = parseQueryRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_thread_events",
      type: "query",
      name: "threads.get_events",
      payload: {
        thread_id: "thread_123",
        from_sequence: 1,
      },
    })

    expect(query.name).toBe("threads.get_events")
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

  it("parses terminal session snapshots, results, and events", () => {
    const session = parseTerminalSessionSnapshot({
      sessionId: "term_123",
      projectId: "proj_123",
      sandboxId: "sandbox_123",
      threadId: null,
      cwd: "/tmp/project",
      title: "Main",
      sessionKind: "shell",
      status: "running",
      commandId: null,
      commandLabel: null,
      commandLine: "/bin/bash",
      exitCode: null,
      startedAt: "2026-03-15T00:00:00Z",
      updatedAt: "2026-03-15T00:00:00Z",
      lastOutputAt: null,
      lastOutputSequence: 0,
      recentOutput: "",
    })
    const sessionsResult = parseTerminalListSessionsResult({
      sessions: [session],
    })
    const commandsResult = parseTerminalListSavedCommandsResult({
      commands: [
        parseSavedCommandSnapshot({
          commandId: "test",
          label: "Test",
          commandLine: "pnpm run test",
          isAvailable: true,
          reasonUnavailable: null,
        }),
      ],
    })
    const sessionsEvent = parseTerminalSessionsEvent(
      parseSubscriptionEventEnvelope({
        protocol_version: IPC_PROTOCOL_VERSION,
        type: "event",
        subscription_id: "sub_123",
        event_name: "terminal.sessions",
        payload: {
          project_id: "proj_123",
          sessions: [session],
        },
      }),
    )
    const outputEvent = parseTerminalOutputEvent(
      parseSubscriptionEventEnvelope({
        protocol_version: IPC_PROTOCOL_VERSION,
        type: "event",
        subscription_id: "sub_456",
        event_name: "terminal.output",
        payload: {
          project_id: "proj_123",
          session_id: "term_123",
          sequence_number: 1,
          chunk: "hello",
          occurred_at: "2026-03-15T00:00:01Z",
        },
      }),
    )

    expect(sessionsResult.sessions[0]?.sessionId).toBe("term_123")
    expect(commandsResult.commands[0]?.commandId).toBe("test")
    expect(sessionsEvent.payload.project_id).toBe("proj_123")
    expect(outputEvent.payload.chunk).toBe("hello")
  })

  it("parses artifact bundles, snapshots, and load results", () => {
    const bundle = parseArtifactBundle({
      artifactType: "runtime_output_bundle",
      title: "Runtime failure",
      summary: "Runtime output summary",
      capturedAt: "2026-03-16T10:00:00Z",
      source: {
        surface: "runtime",
        metadata: {
          sessionId: "term_123",
        },
      },
      payload: {
        processType: "test",
        command: "pnpm test",
        cwd: "/tmp/project",
        exitCode: 1,
        terminalOutput: "short output",
        debugOutput: "debug output",
      },
    })

    const snapshot = parseArtifactSnapshot({
      artifactId: "artifact_123",
      projectId: "proj_123",
      threadId: "thread_123",
      artifactType: "runtime_output_bundle",
      title: "Runtime failure",
      path: "proj_123/thread_123/artifact_123",
      metadata: {
        artifactType: "runtime_output_bundle",
        title: "Runtime failure",
        summary: "Runtime output summary",
        capturedAt: "2026-03-16T10:00:00Z",
        source: {
          surface: "runtime",
          metadata: {
            sessionId: "term_123",
          },
        },
        payload: {
          processType: "test",
          command: "pnpm test",
          cwd: "/tmp/project",
          exitCode: 1,
          terminalOutput: null,
          debugOutput: "debug output",
        },
        largeContentRefs: [
          {
            logicalKey: "terminalOutput",
            relativePath: "terminalOutput.txt",
            byteSize: 2048,
            contentType: "text/plain; charset=utf-8",
          },
        ],
      },
      createdAt: "2026-03-16T10:01:00Z",
    })
    const loadResult = parseArtifactLoadResult({
      artifact: snapshot,
      bundle,
    })

    expect(bundle.artifactType).toBe("runtime_output_bundle")
    expect(snapshot.metadata.largeContentRefs).toHaveLength(1)
    expect(loadResult.bundle.payload.terminalOutput).toBe("short output")
  })

  it("rejects malformed artifact bundle shapes and spill refs", () => {
    expect(() =>
      parseArtifactBundle({
        artifactType: "runtime_output_bundle",
        title: "Broken",
        summary: "Missing payload fields",
        capturedAt: "2026-03-16T10:00:00Z",
        source: {
          surface: "runtime",
          metadata: {},
        },
        payload: {
          command: "pnpm test",
        },
      }),
    ).toThrow()

    expect(() =>
      parseArtifactSnapshot({
        artifactId: "artifact_123",
        projectId: "proj_123",
        threadId: "thread_123",
        artifactType: "runtime_output_bundle",
        title: "Broken snapshot",
        path: "proj_123/thread_123/artifact_123",
        metadata: {
          artifactType: "runtime_output_bundle",
          title: "Broken snapshot",
          summary: "Summary",
          capturedAt: "2026-03-16T10:01:00Z",
          source: {
            surface: "runtime",
            metadata: {},
          },
          payload: {},
          largeContentRefs: [
            {
              logicalKey: "",
              relativePath: "",
              byteSize: -1,
              contentType: "",
            },
          ],
        },
        createdAt: "2026-03-16T10:02:00Z",
      }),
    ).toThrow()
  })

  it("parses artifacts.capture_runtime command envelopes and results", () => {
    const command = parseCommandRequest({
      protocol_version: IPC_PROTOCOL_VERSION,
      request_id: "req_capture_runtime",
      type: "command",
      name: "artifacts.capture_runtime",
      payload: {
        project_id: "proj_123",
        session_id: "term_123",
      },
    })

    const result = parseArtifactsCaptureRuntimeResult({
      artifactId: "artifact_123",
      projectId: "proj_123",
      threadId: "thread_123",
      artifactType: "terminal_output_bundle",
      title: "Captured terminal output",
      path: null,
      metadata: {
        artifactType: "terminal_output_bundle",
        title: "Captured terminal output",
        summary: "Captured shell output from Main",
        capturedAt: "2026-03-16T16:00:00Z",
        source: {
          surface: "terminal",
          metadata: {
            sessionId: "term_123",
          },
        },
        payload: {
          command: "/bin/zsh",
          cwd: "/tmp/project",
          exitCode: null,
          output: "hello world",
        },
        largeContentRefs: [],
      },
      createdAt: "2026-03-16T16:00:00Z",
    })

    expect(command.name).toBe("artifacts.capture_runtime")
    expect(result.artifactType).toBe("terminal_output_bundle")
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

  it("parses sandbox list results", () => {
    const result = parseSandboxesListResult({
      sandboxes: [
        {
          sandboxId: "sandbox_123",
          projectId: "proj_123",
          threadId: null,
          path: "/Users/tony/Projects/ultra",
          displayName: "Main",
          sandboxType: "main_checkout",
          branchName: "main",
          baseBranch: "main",
          isMainCheckout: true,
          createdAt: "2026-03-16T00:00:00Z",
          updatedAt: "2026-03-16T00:00:00Z",
          lastUsedAt: "2026-03-16T00:00:00Z",
        },
      ],
    })

    expect(result.sandboxes).toHaveLength(1)
  })

  it("parses chat snapshots", () => {
    const snapshot = parseChatSnapshot({
      id: "chat_123",
      projectId: "proj_123",
      title: "Untitled Chat",
      status: "active",
      provider: "codex",
      model: "gpt-5.4",
      thinkingLevel: "default",
      permissionLevel: "supervised",
      isPinned: false,
      pinnedAt: null,
      archivedAt: null,
      lastCompactedAt: null,
      currentSessionId: "chat_sess_123",
      createdAt: "2026-03-14T12:00:00Z",
      updatedAt: "2026-03-14T12:00:00Z",
    })

    expect(snapshot.model).toBe("gpt-5.4")
  })

  it("parses chat list results", () => {
    const result = parseChatsListResult({
      chats: [
        {
          id: "chat_123",
          projectId: "proj_123",
          title: "Untitled Chat",
          status: "active",
          provider: "codex",
          model: "gpt-5.4",
          thinkingLevel: "default",
          permissionLevel: "supervised",
          isPinned: true,
          pinnedAt: "2026-03-14T12:01:00Z",
          archivedAt: null,
          lastCompactedAt: null,
          currentSessionId: "chat_sess_123",
          createdAt: "2026-03-14T12:00:00Z",
          updatedAt: "2026-03-14T12:01:00Z",
        },
      ],
    })

    expect(result.chats).toHaveLength(1)
  })

  it("accepts claude as a chat provider", () => {
    const snapshot = parseChatSnapshot({
      id: "chat_456",
      projectId: "proj_123",
      title: "Claude Chat",
      status: "active",
      provider: "claude",
      model: "sonnet",
      thinkingLevel: "default",
      permissionLevel: "supervised",
      isPinned: false,
      pinnedAt: null,
      archivedAt: null,
      lastCompactedAt: null,
      currentSessionId: "chat_sess_456",
      createdAt: "2026-03-14T12:00:00Z",
      updatedAt: "2026-03-14T12:00:00Z",
    })

    expect(snapshot.provider).toBe("claude")
  })

  it("parses thread detail results", () => {
    const result = parseThreadDetailResult({
      thread: {
        id: "thread_123",
        projectId: "proj_123",
        sourceChatId: "chat_123",
        title: "Thread",
        summary: "Summary",
        executionState: "queued",
        reviewState: "not_ready",
        publishState: "not_requested",
        backendHealth: "healthy",
        coordinatorHealth: "healthy",
        watchHealth: "healthy",
        ovProjectId: null,
        ovCoordinatorId: null,
        ovThreadKey: null,
        worktreeId: null,
        branchName: null,
        baseBranch: null,
        latestCommitSha: null,
        prProvider: null,
        prNumber: null,
        prUrl: null,
        lastEventSequence: 1,
        restartCount: 0,
        failureReason: null,
        createdByMessageId: "msg_start",
        createdAt: "2026-03-16T00:00:00Z",
        updatedAt: "2026-03-16T00:00:00Z",
        lastActivityAt: "2026-03-16T00:00:00Z",
        approvedAt: null,
        completedAt: null,
      },
      specRefs: [],
      ticketRefs: [],
    })

    expect(result.thread.id).toBe("thread_123")
  })

  it("parses thread event snapshots and list results", () => {
    const event = parseThreadEventSnapshot({
      eventId: "thread_event_123",
      projectId: "proj_123",
      threadId: "thread_123",
      sequenceNumber: 1,
      eventType: "thread.created",
      actorType: "chat",
      actorId: "chat_123",
      source: "ultra.chat",
      payload: {
        creationSource: "start_thread",
      },
      occurredAt: "2026-03-16T00:00:00Z",
      recordedAt: "2026-03-16T00:00:00Z",
    })
    const listResult = parseThreadsListResult({
      threads: [
        {
          id: "thread_123",
          projectId: "proj_123",
          sourceChatId: "chat_123",
          title: "Thread",
          summary: "Summary",
          executionState: "queued",
          reviewState: "not_ready",
          publishState: "not_requested",
          backendHealth: "healthy",
          coordinatorHealth: "healthy",
          watchHealth: "healthy",
          ovProjectId: null,
          ovCoordinatorId: null,
          ovThreadKey: null,
          worktreeId: null,
          branchName: null,
          baseBranch: null,
          latestCommitSha: null,
          prProvider: null,
          prNumber: null,
          prUrl: null,
          lastEventSequence: 1,
          restartCount: 0,
          failureReason: null,
          createdByMessageId: "msg_start",
          createdAt: "2026-03-16T00:00:00Z",
          updatedAt: "2026-03-16T00:00:00Z",
          lastActivityAt: "2026-03-16T00:00:00Z",
          approvedAt: null,
          completedAt: null,
        },
      ],
    })

    expect(event.eventType).toBe("thread.created")
    expect(listResult.threads).toHaveLength(1)
  })

  it("parses runtime snapshots", () => {
    const runtime = parseProjectRuntimeSnapshot({
      projectRuntimeId: "project_runtime_123",
      projectId: "proj_123",
      coordinatorId: "coord_123",
      coordinatorInstanceId: "coord_inst_123",
      status: "idle",
      startedAt: "2026-03-14T12:00:00Z",
      lastHeartbeatAt: "2026-03-14T12:05:00Z",
      restartCount: 1,
      createdAt: "2026-03-14T12:00:00Z",
      updatedAt: "2026-03-14T12:05:00Z",
    })
    const component = parseRuntimeComponentSnapshot({
      componentId: "component_123",
      projectId: "proj_123",
      componentType: "coordinator",
      scope: "project",
      processId: 4242,
      status: "healthy",
      startedAt: "2026-03-14T12:00:00Z",
      lastHeartbeatAt: "2026-03-14T12:05:00Z",
      restartCount: 0,
      reason: null,
      details: {
        coordinatorInstanceId: "coord_inst_123",
      },
      createdAt: "2026-03-14T12:00:00Z",
      updatedAt: "2026-03-14T12:05:00Z",
    })
    const healthCheck = parseRuntimeHealthCheckSnapshot({
      healthCheckId: "health_123",
      componentId: "component_123",
      projectId: "proj_123",
      status: "healthy",
      checkedAt: "2026-03-14T12:05:00Z",
      lastHeartbeatAt: "2026-03-14T12:05:00Z",
      reason: null,
      details: {
        source: "heartbeat",
      },
    })
    const summary = parseProjectRuntimeHealthSummary({
      projectId: "proj_123",
      status: "healthy",
      latestReason: null,
      components: [component],
    })

    expect(runtime.status).toBe("idle")
    expect(component.componentType).toBe("coordinator")
    expect(healthCheck.details?.source).toBe("heartbeat")
    expect(summary.components).toHaveLength(1)
  })

  it("parses sandbox list results", () => {
    const result = parseSandboxesListResult({
      sandboxes: [
        {
          sandboxId: "sandbox_123",
          projectId: "proj_123",
          threadId: null,
          path: "/Users/tony/Projects/ultra",
          displayName: "Main",
          sandboxType: "main_checkout",
          branchName: null,
          baseBranch: null,
          isMainCheckout: true,
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
          lastUsedAt: "2026-03-15T00:00:00Z",
        },
      ],
    })

    expect(result.sandboxes).toHaveLength(1)
    expect(result.sandboxes[0]?.displayName).toBe("Main")
  })

  it("parses terminal runtime profile results", () => {
    const result = parseTerminalRuntimeProfileResult({
      sandbox: {
        sandboxId: "sandbox_123",
        projectId: "proj_123",
        threadId: null,
        path: "/Users/tony/Projects/ultra",
        displayName: "Main",
        sandboxType: "main_checkout",
        branchName: null,
        baseBranch: null,
        isMainCheckout: true,
        createdAt: "2026-03-15T00:00:00Z",
        updatedAt: "2026-03-15T00:00:00Z",
        lastUsedAt: "2026-03-15T00:00:00Z",
      },
      profile: {
        projectId: "proj_123",
        runtimeFilePaths: [".env"],
        envVars: {},
        createdAt: "2026-03-15T00:00:00Z",
        updatedAt: "2026-03-15T00:00:00Z",
      },
      sync: {
        syncId: "sync_123",
        sandboxId: "sandbox_123",
        projectId: "proj_123",
        syncMode: "managed_copy",
        status: "synced",
        syncedFiles: [".env"],
        lastSyncedAt: "2026-03-15T00:01:00Z",
        details: {
          checkedAt: "2026-03-15T00:01:00Z",
          copiedFiles: [".env"],
          staleFiles: [],
          missingSourceFiles: [],
          invalidPaths: [],
          error: null,
        },
        createdAt: "2026-03-15T00:00:00Z",
        updatedAt: "2026-03-15T00:01:00Z",
      },
    })

    expect(result.profile.runtimeFilePaths).toEqual([".env"])
    expect(result.sync.status).toBe("synced")
  })

  it("rejects a runtime sync sandbox query because it is not public yet", () => {
    expect(() =>
      parseQueryRequest({
        protocol_version: IPC_PROTOCOL_VERSION,
        request_id: "req_runtime_sync",
        type: "query",
        name: "sandboxes.get_runtime_sync",
        payload: {
          sandbox_id: "sandbox_123",
        },
      }),
    ).toThrow()
  })

  it("rejects malformed runtime values", () => {
    expect(() =>
      parseRuntimeComponentSnapshot({
        componentId: "component_123",
        projectId: "proj_123",
        componentType: "worker",
        scope: "project",
        processId: null,
        status: "healthy",
        startedAt: null,
        lastHeartbeatAt: null,
        restartCount: 0,
        reason: null,
        details: null,
        createdAt: "2026-03-14T12:00:00Z",
        updatedAt: "2026-03-14T12:00:00Z",
      }),
    ).toThrow()
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
