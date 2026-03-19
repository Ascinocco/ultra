// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AppStoreProvider,
  createAppStore,
  type AppStoreState,
} from "../state/app-store.js"
import { makeChat, makeProject } from "../test-utils/factories.js"
import { ChatPageShell } from "./ChatPageShell.js"

const {
  fetchChatMessagesMock,
  fetchChatTurnMock,
  fetchChatTurnsMock,
  replayChatTurnEventsMock,
  selectCurrentTurnMock,
  startChatTurnMock,
  subscribeToChatMessagesMock,
  subscribeToChatTurnEventsMock,
  fetchThreadMessagesMock,
  fetchThreadsMock,
  sendThreadMessageMock,
  updateChatRuntimeConfigMock,
} = vi.hoisted(() => ({
  fetchChatMessagesMock: vi.fn(),
  fetchChatTurnMock: vi.fn(),
  fetchChatTurnsMock: vi.fn(),
  replayChatTurnEventsMock: vi.fn(),
  selectCurrentTurnMock: vi.fn(),
  startChatTurnMock: vi.fn(),
  subscribeToChatMessagesMock: vi.fn(),
  subscribeToChatTurnEventsMock: vi.fn(),
  fetchThreadMessagesMock: vi.fn(),
  fetchThreadsMock: vi.fn(),
  sendThreadMessageMock: vi.fn(),
  updateChatRuntimeConfigMock: vi.fn(),
}))

vi.mock("../terminal/TerminalPane.js", () => ({
  TerminalPane: () => null,
}))

vi.mock("../chats/chat-message-workflows.js", () => ({
  fetchChatMessages: fetchChatMessagesMock,
  fetchChatTurn: fetchChatTurnMock,
  fetchChatTurns: fetchChatTurnsMock,
  replayChatTurnEvents: replayChatTurnEventsMock,
  selectCurrentTurn: selectCurrentTurnMock,
  startChatTurn: startChatTurnMock,
  subscribeToChatMessages: subscribeToChatMessagesMock,
  subscribeToChatTurnEvents: subscribeToChatTurnEventsMock,
}))

vi.mock("../threads/thread-workflows.js", () => ({
  fetchThreadMessages: fetchThreadMessagesMock,
  fetchThreads: fetchThreadsMock,
  sendThreadMessage: sendThreadMessageMock,
}))

vi.mock("../sidebar/chat-workflows.js", () => ({
  updateChatRuntimeConfig: updateChatRuntimeConfigMock,
}))

function setActiveChatLayout(
  state: AppStoreState,
  projectId: string,
  chatId: string,
): void {
  state.actions.setLayoutForProject(projectId, {
    currentPage: "chat",
    rightTopCollapsed: false,
    selectedRightPaneTab: null,
    activeChatId: chatId,
    selectedThreadId: null,
    lastEditorTargetId: null,
    sidebarCollapsed: false,
    chatThreadSplitRatio: 0.55,
  })
}

function setReadyRuntimeChecks(state: AppStoreState): void {
  state.actions.setReadinessSnapshot({
    status: "ready",
    sessionMode: "desktop",
    checkedAt: "2026-03-19T12:00:00.000Z",
    checks: [
      {
        tool: "claude",
        displayName: "Claude CLI",
        scope: "runtime-required",
        requiredInCurrentSession: true,
        status: "ready",
        detectedVersion: "1.0.0",
        command: "claude --version",
        helpText: "Claude is ready",
      },
      {
        tool: "codex",
        displayName: "Codex CLI",
        scope: "runtime-required",
        requiredInCurrentSession: true,
        status: "ready",
        detectedVersion: "1.0.0",
        command: "codex --version",
        helpText: "Codex is ready",
      },
    ],
  })
}

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  vi.clearAllMocks()

  // Required for React's act() warnings in non-testing-library harnesses.
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  ;(
    globalThis as typeof globalThis & {
      ResizeObserver?: typeof ResizeObserver
    }
  ).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver

  fetchChatMessagesMock.mockResolvedValue(undefined)
  fetchChatTurnMock.mockResolvedValue(undefined)
  fetchChatTurnsMock.mockResolvedValue({ turns: [], nextCursor: null })
  replayChatTurnEventsMock.mockResolvedValue({ events: [] })
  selectCurrentTurnMock.mockReturnValue(null)
  startChatTurnMock.mockResolvedValue({
    turn: { turnId: "chat_turn_1" },
  })
  subscribeToChatMessagesMock.mockResolvedValue(async () => undefined)
  subscribeToChatTurnEventsMock.mockResolvedValue(async () => undefined)
  fetchThreadMessagesMock.mockResolvedValue(undefined)
  fetchThreadsMock.mockResolvedValue(undefined)
  sendThreadMessageMock.mockResolvedValue(undefined)
  updateChatRuntimeConfigMock.mockResolvedValue(undefined)

  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
    root = null
  }
  container.remove()
})

async function renderChatPageInteraction(
  setup?: (store: ReturnType<typeof createAppStore>) => void,
): Promise<void> {
  const store = createAppStore({ connectionStatus: "disconnected" })
  setup?.(store)

  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppStoreProvider store={store}>
        <ChatPageShell
          onOpenProject={() => undefined}
          onOpenSettings={() => undefined}
        />
      </AppStoreProvider>,
    )
    await Promise.resolve()
  })
}

function requireSelect(id: string): HTMLSelectElement {
  const element = container.querySelector(`#${id}`)
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Expected select #${id} to exist`)
  }
  return element
}

async function changeSelect(
  select: HTMLSelectElement,
  value: string,
): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event("change", { bubbles: true }))
    await Promise.resolve()
  })
}

describe("ChatPageShell runtime selector interactions", () => {
  it("persists expected payload when provider changes", async () => {
    const project = makeProject("proj-1", "ultra")
    const chat = makeChat("chat-1", project.id, {
      provider: "claude",
      model: "claude-sonnet-4-6",
      thinkingLevel: "high",
      permissionLevel: "full_access",
    })

    await renderChatPageInteraction((store) => {
      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      state.actions.setThreadsForProject(project.id, [])
      setReadyRuntimeChecks(state)
      setActiveChatLayout(state, project.id, chat.id)
    })

    const providerSelect = requireSelect("chat-runtime-provider")
    await changeSelect(providerSelect, "codex")

    expect(updateChatRuntimeConfigMock).toHaveBeenCalledTimes(1)
    expect(updateChatRuntimeConfigMock).toHaveBeenCalledWith(
      chat.id,
      {
        provider: "codex",
        model: "gpt-5.4",
        thinkingLevel: "high",
        permissionLevel: "full_access",
      },
      expect.any(Object),
    )
  })

  it("persists expected payload when model changes", async () => {
    const project = makeProject("proj-1", "ultra")
    const chat = makeChat("chat-1", project.id, {
      provider: "claude",
      model: "claude-sonnet-4-6",
      thinkingLevel: "normal",
      permissionLevel: "supervised",
    })

    await renderChatPageInteraction((store) => {
      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      state.actions.setThreadsForProject(project.id, [])
      setReadyRuntimeChecks(state)
      setActiveChatLayout(state, project.id, chat.id)
    })

    const modelSelect = requireSelect("chat-runtime-model")
    await changeSelect(modelSelect, "claude-opus-4-6")

    expect(updateChatRuntimeConfigMock).toHaveBeenCalledTimes(1)
    expect(updateChatRuntimeConfigMock).toHaveBeenCalledWith(
      chat.id,
      {
        provider: "claude",
        model: "claude-opus-4-6",
        thinkingLevel: "normal",
        permissionLevel: "supervised",
      },
      expect.any(Object),
    )
  })
})
