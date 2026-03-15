import { BrowserPageShell } from "../pages/BrowserPageShell.js"
import { ChatPageShell } from "../pages/ChatPageShell.js"
import { EditorPageShell } from "../pages/EditorPageShell.js"
import { useAppStore } from "../state/app-store.js"
import { ProjectFrame } from "./ProjectFrame.js"
import { RuntimeIndicator } from "./RuntimeIndicator.js"
import { TopNav } from "./TopNav.js"

export function AppShell() {
  const app = useAppStore((state) => state.app)
  const setCurrentPage = useAppStore((state) => state.actions.setCurrentPage)

  return (
    <main className="app-shell">
      <header className="app-shell__header">
        <ProjectFrame activeProjectId={app.activeProjectId} />
        <div className="app-shell__nav-wrap">
          <TopNav currentPage={app.currentPage} onSelectPage={setCurrentPage} />
        </div>
        <RuntimeIndicator
          status={app.connectionStatus}
          detail={app.backendStatus.message}
        />
      </header>

      <section className="app-shell__body">
        <ChatPageShell active={app.currentPage === "chat"} />
        <EditorPageShell active={app.currentPage === "editor"} />
        <BrowserPageShell active={app.currentPage === "browser"} />
      </section>
    </main>
  )
}
