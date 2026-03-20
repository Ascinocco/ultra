import type {
  ChatMessageSnapshot,
  ChatSummary,
  ProjectSnapshot,
  SandboxContextSnapshot,
  TerminalSessionSnapshot,
  ThreadMessageSnapshot,
  ThreadSnapshot,
} from "@ultra/shared"

export function makeProject(id: string, name: string): ProjectSnapshot {
  return {
    id,
    key: name.toLowerCase(),
    name,
    rootPath: `/projects/${name.toLowerCase()}`,
    gitRootPath: null,
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    lastOpenedAt: null,
  }
}

export function makeChat(
  id: string,
  projectId: string,
  opts?: Partial<ChatSummary>,
): ChatSummary {
  return {
    id,
    projectId,
    title: `Chat ${id}`,
    status: "active",
    provider: "claude",
    model: "claude-sonnet-4-6",
    thinkingLevel: "normal",
    permissionLevel: "supervised",
    isPinned: false,
    pinnedAt: null,
    archivedAt: null,
    lastCompactedAt: null,
    currentSessionId: null,
    workspaceDescription: null,
    turnStatus: null,
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    ...opts,
  }
}

export function makeChatMessage(
  id: string,
  chatId: string,
  opts?: Partial<ChatMessageSnapshot>,
): ChatMessageSnapshot {
  return {
    id,
    chatId,
    sessionId: "chat_sess_1",
    role: "assistant",
    messageType: "assistant_text",
    contentMarkdown: "Hello from assistant",
    structuredPayloadJson: null,
    providerMessageId: null,
    createdAt: "2026-03-18T00:00:00.000Z",
    ...opts,
  }
}

export function makeSandbox(
  id: string,
  projectId: string,
  opts?: Partial<SandboxContextSnapshot>,
): SandboxContextSnapshot {
  return {
    sandboxId: id,
    projectId,
    threadId: null,
    path: `/projects/${projectId}`,
    displayName: `Sandbox ${id}`,
    sandboxType: "main_checkout",
    branchName: "main",
    baseBranch: null,
    isMainCheckout: true,
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    lastUsedAt: null,
    ...opts,
  }
}

export function makeTerminalSession(
  sessionId: string,
  projectId: string,
  sandboxId: string,
  opts?: Partial<TerminalSessionSnapshot>,
): TerminalSessionSnapshot {
  return {
    sessionId,
    projectId,
    sandboxId,
    threadId: null,
    cwd: `/projects/${projectId}`,
    title: `Shell · ${sessionId}`,
    sessionKind: "shell",
    status: "running",
    commandId: null,
    commandLabel: null,
    commandLine: "zsh",
    exitCode: null,
    startedAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
    lastOutputAt: null,
    lastOutputSequence: 0,
    recentOutput: "",
    displayName: null,
    pinned: false,
    ...opts,
  }
}

export function makeThread(
  id: string,
  projectId: string,
  opts?: Partial<ThreadSnapshot>,
): ThreadSnapshot {
  return {
    id,
    projectId,
    sourceChatId: "chat_1",
    title: `Thread ${id}`,
    summary: null,
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
    lastEventSequence: 0,
    restartCount: 0,
    failureReason: null,
    createdByMessageId: null,
    createdAt: "2026-03-16T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
    lastActivityAt: null,
    approvedAt: null,
    completedAt: null,
    ...opts,
  }
}

export function makeThreadMessage(
  id: string,
  threadId: string,
  opts?: Partial<ThreadMessageSnapshot>,
): ThreadMessageSnapshot {
  return {
    id,
    threadId,
    role: "coordinator",
    provider: null,
    model: null,
    messageType: "text",
    content: { text: "Hello from coordinator" },
    artifactRefs: [],
    createdAt: "2026-03-16T00:00:00.000Z",
    ...opts,
  }
}
