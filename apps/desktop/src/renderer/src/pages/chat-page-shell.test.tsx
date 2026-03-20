import type { ChatTurnSnapshot } from "@ultra/shared"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  AppStoreProvider,
  createAppStore,
  type AppStoreState,
} from "../state/app-store.js"
import {
  makeChat,
  makeChatMessage,
  makeProject,
} from "../test-utils/factories.js"
import { ChatPageShell } from "./ChatPageShell.js"

vi.mock("../terminal/TerminalPane.js", () => ({
  TerminalPane: () => null,
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

function makeTurn(
  turnId: string,
  chatId: string,
  overrides: Partial<ChatTurnSnapshot> = {},
): ChatTurnSnapshot {
  return {
    turnId,
    chatId,
    sessionId: "chat_sess_1",
    clientTurnId: null,
    userMessageId: "chat_msg_user_1",
    assistantMessageId: null,
    status: "queued",
    provider: "claude",
    model: "claude-sonnet-4-6",
    vendorSessionId: null,
    startedAt: "2026-03-19T12:00:00.000Z",
    updatedAt: "2026-03-19T12:00:00.000Z",
    completedAt: null,
    failureCode: null,
    failureMessage: null,
    cancelRequestedAt: null,
    ...overrides,
  }
}

function renderChatPage(
  setup?: (store: ReturnType<typeof createAppStore>) => void,
): string {
  const store = createAppStore({ connectionStatus: "connected" })
  setup?.(store)

  const currentState = store.getState()
  store.getInitialState = () => currentState

  return renderToStaticMarkup(
    <AppStoreProvider store={store}>
      <ChatPageShell
        onOpenProject={() => undefined}
        onOpenSettings={() => undefined}
      />
    </AppStoreProvider>,
  )
}

describe("ChatPageShell pre-send runtime config", () => {
  it("renders InputDock with model pill before the first message", () => {
    const markup = renderChatPage((store) => {
      const project = makeProject("proj-1", "ultra")
      const chat = makeChat("chat-1", project.id, {
        provider: "claude",
        model: "claude-sonnet-4-6",
      })

      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      setActiveChatLayout(state, project.id, chat.id)
    })

    expect(markup).toContain("input-dock")
    expect(markup).toContain("claude-sonnet-4-6")
  })

  it("renders InputDock with read-only pills after transcript has messages", () => {
    const markup = renderChatPage((store) => {
      const project = makeProject("proj-1", "ultra")
      const chat = makeChat("chat-1", project.id)

      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      setActiveChatLayout(state, project.id, chat.id)
      state.actions.setMessagesForChat(
        chat.id,
        [makeChatMessage("chat_msg_1", chat.id, { role: "user" })],
      )
    })

    // Pills should be read-only (disabled) after first turn
    expect(markup).toContain("input-dock__pill--readonly")
  })

  it("renders persisted provider/model values for selected chat state", () => {
    const markup = renderChatPage((store) => {
      const project = makeProject("proj-1", "ultra")
      const chat = makeChat("chat-1", project.id, {
        provider: "codex",
        model: "gpt-5.4",
      })

      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      setActiveChatLayout(state, project.id, chat.id)
    })

    expect(markup).toContain("codex · gpt-5.4")
    expect(markup).toContain("gpt-5.4")
  })

  it("disables InputDock when readiness marks selected provider non-ready", () => {
    const markup = renderChatPage((store) => {
      const project = makeProject("proj-1", "ultra")
      const chat = makeChat("chat-1", project.id, {
        provider: "claude",
        model: "claude-sonnet-4-6",
      })

      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      setActiveChatLayout(state, project.id, chat.id)
      state.actions.setReadinessSnapshot({
        status: "blocked",
        sessionMode: "desktop",
        checkedAt: "2026-03-19T12:00:00.000Z",
        checks: [
          {
            tool: "claude",
            displayName: "Claude CLI",
            scope: "runtime-required",
            requiredInCurrentSession: true,
            status: "missing",
            detectedVersion: null,
            command: "claude --version",
            helpText: "Install Claude CLI",
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
    })

    // The textarea should be readOnly when disabled
    expect(markup).toContain("readOnly")
  })

  it("disables InputDock when provider unavailable after transcript exists", () => {
    const markup = renderChatPage((store) => {
      const project = makeProject("proj-1", "ultra")
      const chat = makeChat("chat-1", project.id, {
        provider: "codex",
        model: "gpt-5.4",
      })

      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      setActiveChatLayout(state, project.id, chat.id)
      state.actions.setMessagesForChat(
        chat.id,
        [makeChatMessage("chat_msg_1", chat.id, { role: "user" })],
      )
      state.actions.setReadinessSnapshot({
        status: "blocked",
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
            status: "missing",
            detectedVersion: null,
            command: "codex --version",
            helpText: "Install Codex CLI and ensure `codex` is on PATH.",
          },
        ],
      })
    })

    // The textarea should be readOnly when disabled
    expect(markup).toContain("readOnly")
  })

  it("renders InputDock with failed turn state", () => {
    const markup = renderChatPage((store) => {
      const project = makeProject("proj-1", "ultra")
      const chat = makeChat("chat-1", project.id, {
        provider: "codex",
        model: "gpt-5.4",
      })
      const failedTurn = makeTurn("chat_turn_1", chat.id, {
        status: "failed",
        provider: "codex",
        model: "gpt-5.4",
        failureCode: "runtime_unavailable",
        failureMessage:
          "Codex runtime is unavailable because 'codex' was not found on PATH. Install Codex CLI and ensure `codex` is on PATH.",
        completedAt: "2026-03-19T12:00:10.000Z",
      })

      const state = store.getState()
      state.actions.setProjects([project])
      state.actions.setActiveProjectId(project.id)
      state.actions.setChatsForProject(project.id, [chat])
      setActiveChatLayout(state, project.id, chat.id)
      state.actions.setMessagesForChat(
        chat.id,
        [makeChatMessage("chat_msg_1", chat.id, { role: "user" })],
      )
      state.actions.setTurnsForChat(chat.id, [failedTurn])
    })

    // InputDock should still render, turn failure is shown in transcript area
    expect(markup).toContain("input-dock")
    expect(markup).toContain("Failed")
  })
})
