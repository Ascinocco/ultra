import type { ChatSummary, ProjectSnapshot, SandboxContextSnapshot } from "@ultra/shared"

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

export function makeChat(id: string, projectId: string, opts?: Partial<ChatSummary>): ChatSummary {
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
