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
  it("shows provider/model selectors before the first message", () => {
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

    expect(markup).toContain("Runtime for first turn")
    expect(markup).toContain('id="chat-runtime-provider"')
    expect(markup).toContain('id="chat-runtime-model"')
    expect(markup).toContain("claude-sonnet-4-6")
  })

  it("hides pre-send selectors after the transcript already has messages", () => {
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

    expect(markup).not.toContain("Runtime for first turn")
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

  it("flags unavailable providers when readiness data marks them non-ready", () => {
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

    expect(markup).toContain("Claude (unavailable)")
    expect(markup).toContain("The selected provider is unavailable")
  })
})
