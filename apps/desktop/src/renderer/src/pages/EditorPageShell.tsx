export function EditorPageShell({ active }: { active: boolean }) {
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
              <h2 className="surface__title">No checkout selected</h2>
            </div>
            <span className="surface__badge">Runtime sync idle</span>
          </div>
        </section>

        <section className="surface editor-layout__workspace">
          <div className="surface__header">
            <p className="surface__eyebrow">Workspace</p>
            <h2 className="surface__title">Dedicated coding surface</h2>
          </div>
          <div className="placeholder-card placeholder-card--tall">
            <strong>Files, diffs, and review live here</strong>
            <p>
              This page is intentionally separate from chat so editing and
              review feel like a focused workspace rather than a sidebar
              feature.
            </p>
          </div>
        </section>

        <section className="surface">
          <div className="surface__header">
            <p className="surface__eyebrow">Bottom Panel</p>
            <h2 className="surface__title">Terminal and output</h2>
          </div>
          <div className="placeholder-card">
            <strong>Tests, debug, and terminal output</strong>
            <p>
              The bottom panel placeholder reserves the space for run/debug and
              terminal workflows in later milestones.
            </p>
          </div>
        </section>
      </div>
    </section>
  )
}
