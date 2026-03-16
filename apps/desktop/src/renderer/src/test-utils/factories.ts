import type {
  ChatSummary,
  ProjectSnapshot,
  SandboxContextSnapshot,
  TerminalSessionSnapshot,
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
    createdAt: "2026-03-14T00:00:00Z",
    updatedAt: "2026-03-14T00:00:00Z",
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
    ...opts,
  }
}
