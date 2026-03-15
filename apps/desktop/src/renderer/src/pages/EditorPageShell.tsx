import type { ProjectSnapshot } from "@ultra/shared"
import { useEffect, useMemo, useRef, useState } from "react"

import type {
  EditorHostRect,
  EditorHostStatusSnapshot,
} from "../../../shared/editor-host.js"

function getRect(element: HTMLDivElement): EditorHostRect {
  const rect = element.getBoundingClientRect()

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

export function EditorPageShell({
  active,
  activeProject,
}: {
  active: boolean
  activeProject: ProjectSnapshot | null
}) {
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const [hostStatus, setHostStatus] = useState<EditorHostStatusSnapshot | null>(
    null,
  )
  const hostMessage = useMemo(() => {
    if (!activeProject) {
      return "Open a project to mount the embedded workbench."
    }

    if (!hostStatus) {
      return "Preparing embedded editor host…"
    }

    return hostStatus.message
  }, [activeProject, hostStatus])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    void window.ultraShell.getEditorHostStatus().then((status) => {
      setHostStatus(status)
    })

    return window.ultraShell.onEditorHostStatusChange((status) => {
      setHostStatus(status)
    })
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (!active || !activeProject || !workspaceRef.current) {
      void window.ultraShell
        .syncEditorHost({
          visible: false,
          bounds: null,
          workspacePath: null,
        })
        .catch(() => undefined)
      return
    }

    const element = workspaceRef.current

    const sync = () => {
      void window.ultraShell
        .syncEditorHost({
          visible: true,
          bounds: getRect(element),
          workspacePath: activeProject.rootPath,
        })
        .catch(() => undefined)
    }

    sync()

    const observer = new ResizeObserver(() => {
      sync()
    })
    observer.observe(element)

    const onWindowResize = () => {
      sync()
    }

    window.addEventListener("resize", onWindowResize)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", onWindowResize)
      void window.ultraShell
        .syncEditorHost({
          visible: false,
          bounds: null,
          workspacePath: null,
        })
        .catch(() => undefined)
    }
  }, [active, activeProject])

  async function handleOpenProjectFile() {
    if (!activeProject) {
      return
    }

    const filePath = await window.ultraShell.pickProjectFile(
      activeProject.rootPath,
    )

    if (!filePath) {
      return
    }

    await window.ultraShell.openEditorFile(filePath)
  }

  async function handleOpenTerminal() {
    if (!activeProject) {
      return
    }

    await window.ultraShell.openEditorTerminal(
      activeProject.rootPath,
      `${activeProject.name} terminal`,
    )
  }

  return (
    <section
      aria-hidden={!active}
      className={`page-shell ${active ? "page-shell--active" : "page-shell--hidden"}`}
      data-page="editor"
    >
      <div className="editor-layout">
        <section className="surface surface--toolbar">
          <div className="surface__header surface__header--inline">
            <div>
              <p className="surface__eyebrow">Editor Target</p>
              <h2 className="surface__title">
                {activeProject ? activeProject.name : "No project open"}
              </h2>
              <p className="surface__caption">
                {activeProject?.rootPath ?? "Open a project to mount Code-OSS."}
              </p>
            </div>
            <div className="editor-toolbar__actions">
              <button
                className="editor-toolbar__button"
                disabled={!activeProject}
                onClick={() => {
                  void handleOpenProjectFile()
                }}
                type="button"
              >
                Open Project File
              </button>
              <button
                className="editor-toolbar__button"
                disabled={!activeProject}
                onClick={() => {
                  void handleOpenTerminal()
                }}
                type="button"
              >
                Open Terminal
              </button>
            </div>
          </div>
        </section>

        <section className="surface editor-layout__workspace">
          <div className="surface__header">
            <p className="surface__eyebrow">Workspace</p>
            <h2 className="surface__title">Embedded Code-OSS workbench</h2>
          </div>

          {!activeProject ? (
            <div className="placeholder-card placeholder-card--tall">
              <strong>Open a project to start the editor spike</strong>
              <p>
                The editor host only mounts when the shell has an active project
                root to hand off as the workspace target.
              </p>
            </div>
          ) : (
            <div className="editor-host">
              <div className="editor-host__slot" ref={workspaceRef} />
              <div className="editor-host__status">
                <strong>Editor Host</strong>
                <p>{hostMessage}</p>
              </div>
            </div>
          )}
        </section>

        <section className="surface">
          <div className="surface__header">
            <p className="surface__eyebrow">Bottom Panel</p>
            <h2 className="surface__title">Shell-owned spike notes</h2>
          </div>
          <div className="placeholder-card">
            <strong>Workflow state stays in Ultra</strong>
            <p>
              This spike lets the embedded workbench own editing and terminal
              surfaces while Ultra keeps navigation, project identity, and
              workflow state in the shell.
            </p>
          </div>
        </section>
      </div>
    </section>
  )
}
