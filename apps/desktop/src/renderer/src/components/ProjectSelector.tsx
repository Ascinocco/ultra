import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ProjectSnapshot } from "@ultra/shared"

export function ProjectSelector({
  activeProject,
  recentProjects,
  canOpenProjects,
  openStatus,
  openError,
  onOpenProject,
  onOpenRecentProject,
}: {
  activeProject: ProjectSnapshot | null
  recentProjects: ProjectSnapshot[]
  canOpenProjects: boolean
  openStatus: "idle" | "opening" | "error"
  openError: string | null
  onOpenProject: () => void
  onOpenRecentProject: (project: ProjectSnapshot) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLButtonElement[]>([])
  const isOpening = openStatus === "opening"

  const triggerLabel = isOpening
    ? "Opening\u2026"
    : activeProject
      ? activeProject.name
      : "Open Project"

  const close = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Reset item refs and focus first item on open
  useEffect(() => {
    if (isOpen) {
      itemsRef.current = []
      requestAnimationFrame(() => {
        itemsRef.current[0]?.focus()
      })
    }
  }, [isOpen])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        close()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen, close])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, close])

  function handleKeyNavigation(event: React.KeyboardEvent) {
    const items = itemsRef.current.filter(Boolean)
    const currentIndex = items.indexOf(event.target as HTMLButtonElement)
    if (currentIndex === -1) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      const next = items[currentIndex + 1]
      if (next) next.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const prev = items[currentIndex - 1]
      if (prev) prev.focus()
    } else if (event.key === "Tab") {
      if (!event.shiftKey && currentIndex === items.length - 1) {
        event.preventDefault()
        close()
      }
    }
  }

  function registerItem(el: HTMLButtonElement | null) {
    if (el && !itemsRef.current.includes(el)) {
      itemsRef.current.push(el)
    }
  }

  // Calculate popover position relative to trigger
  function getPopoverStyle(): React.CSSProperties {
    if (!triggerRef.current) return { top: 48, left: 70 }
    const rect = triggerRef.current.getBoundingClientRect()
    const left = rect.left
    const wouldOverflowRight = left + 320 > window.innerWidth
    return {
      top: rect.bottom + 8,
      left: wouldOverflowRight ? Math.max(16, rect.right - 320) : left,
    }
  }

  const popover = isOpen ? (
    <div
      ref={popoverRef}
      className="project-selector__popover"
      role="menu"
      style={getPopoverStyle()}
      onKeyDown={handleKeyNavigation}
    >
      {/* Active project info */}
      {activeProject ? (
        <div className="project-selector__popover-section">
          <p className="project-selector__popover-name">
            {activeProject.name}
          </p>
          <p className="project-selector__popover-path">
            {activeProject.rootPath}
          </p>
          {activeProject.gitRootPath &&
          activeProject.gitRootPath !== activeProject.rootPath ? (
            <p className="project-selector__popover-meta">
              repo: {activeProject.gitRootPath}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="project-selector__popover-section">
          <p className="project-selector__popover-name">No project open</p>
        </div>
      )}

      {/* Recent projects */}
      {recentProjects.length > 0 ? (
        <div className="project-selector__popover-section">
          <p className="project-selector__popover-label">Recent</p>
          {recentProjects.slice(0, 3).map((project) => (
            <button
              key={project.id}
              ref={registerItem}
              className="project-selector__popover-item"
              role="menuitem"
              type="button"
              disabled={!canOpenProjects || isOpening}
              onClick={() => {
                onOpenRecentProject(project)
                close()
              }}
            >
              <span>{project.name}</span>
              <small>{project.rootPath}</small>
            </button>
          ))}
        </div>
      ) : null}

      {/* Open Project action */}
      <div className="project-selector__popover-section">
        <button
          ref={registerItem}
          className="project-selector__popover-action"
          role="menuitem"
          type="button"
          disabled={!canOpenProjects || isOpening}
          onClick={() => {
            onOpenProject()
            close()
          }}
        >
          Open Project{"\u2026"}
        </button>
      </div>

      {/* Error */}
      {openError ? (
        <p className="project-selector__popover-error">{openError}</p>
      ) : null}
    </div>
  ) : null

  return (
    <div className="project-selector">
      <button
        ref={triggerRef}
        className="project-selector__trigger"
        data-muted={!canOpenProjects || undefined}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="project-selector__trigger-name">{triggerLabel}</span>
        <span aria-hidden="true" className="project-selector__trigger-chevron">
          &#9660;
        </span>
      </button>

      {popover && createPortal(popover, document.body)}
    </div>
  )
}
