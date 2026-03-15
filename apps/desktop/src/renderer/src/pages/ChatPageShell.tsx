import { Sidebar } from "../sidebar/Sidebar.js"

export function ChatPageShell({ active }: { active: boolean }) {
  return (
    <section
      aria-hidden={!active}
      className={`page-shell ${active ? "page-shell--active" : "page-shell--hidden"}`}
      data-page="chat"
    >
      <div className="chat-frame">
        <div className="chat-frame__grid">
          <aside className="chat-frame__rail">
            <Sidebar />
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
        </div>
      </div>
    </section>
  )
}
