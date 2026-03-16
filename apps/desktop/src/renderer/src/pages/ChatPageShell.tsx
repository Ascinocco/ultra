import { useState } from "react"

import { useAppStore } from "../state/app-store.js"
import { Sidebar } from "../sidebar/Sidebar.js"
import { TerminalDrawer } from "../terminal/TerminalDrawer.js"

const DEFAULT_DRAWER_HEIGHT = 200
const MIN_DRAWER_HEIGHT = 100
const MAX_DRAWER_HEIGHT_RATIO = 0.8

export function ChatPageShell({ active, onOpenProject }: { active: boolean; onOpenProject: () => void }) {
  const terminalDrawerOpen = useAppStore((s) => s.app.terminalDrawerOpen)
  const actions = useAppStore((s) => s.actions)
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT)

  function handleResize(height: number) {
    const chatFrame = document.querySelector(".chat-frame")
    const maxHeight = chatFrame
      ? chatFrame.clientHeight * MAX_DRAWER_HEIGHT_RATIO
      : 600
    setDrawerHeight(Math.min(Math.max(height, MIN_DRAWER_HEIGHT), maxHeight))
  }

  return (
    <section
      aria-hidden={!active}
      className={`page-shell ${active ? "page-shell--active" : "page-shell--hidden"}`}
      data-page="chat"
    >
      <div className="chat-frame">
        <div className="chat-frame__grid">
          <aside className="chat-frame__rail">
            <Sidebar onOpenProject={onOpenProject} />
          </aside>

          <section className="chat-frame__main">
            <div className="surface__header">
              <p className="surface__eyebrow">Active Chat</p>
              <h2 className="surface__title">Command center</h2>
            </div>
            <div className="placeholder-card placeholder-card--tall">
              <strong>Plan, spec, and execution setup live here</strong>
              <p>
                The left anchor stays focused on conversation while the right
                side tracks thread execution and runtime health.
              </p>
            </div>
          </section>

          <div className="chat-frame__side">
            <section className="chat-frame__side-top">
              <div className="surface__header">
                <p className="surface__eyebrow">Threads</p>
                <h2 className="surface__title">Execution pane</h2>
              </div>
              <div className="placeholder-card">
                <strong>No threads yet</strong>
                <p>
                  Thread cards and thread detail will expand inside this pane
                  without replacing the chat anchor.
                </p>
              </div>
            </section>
            <section className="chat-frame__side-bottom">
              <div className="surface__header">
                <p className="surface__eyebrow">Status</p>
                <h2 className="surface__title">Runtime summary</h2>
              </div>
              <div className="placeholder-card">
                <strong>Runtime health stays visible</strong>
                <p>
                  This region will hold coordinator, watchdog, and approval
                  state without turning the page into an ops console.
                </p>
              </div>
            </section>
          </div>

          {terminalDrawerOpen && (
            <TerminalDrawer
              height={drawerHeight}
              onResize={handleResize}
              onClose={() => actions.toggleTerminalDrawer()}
            />
          )}
        </div>
      </div>
    </section>
  )
}
