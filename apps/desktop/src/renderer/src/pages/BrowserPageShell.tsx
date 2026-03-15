export function BrowserPageShell({ active }: { active: boolean }) {
  return (
    <section
      aria-hidden={!active}
      className={`page-shell ${active ? "page-shell--active" : "page-shell--hidden"}`}
      data-page="browser"
    >
      <div className="browser-layout">
        <section className="surface surface--toolbar">
          <div className="surface__header surface__header--inline">
            <div>
              <p className="surface__eyebrow">Browser</p>
              <h2 className="surface__title">Manual QA surface</h2>
            </div>
            <span className="surface__badge">
              Persistent session placeholder
            </span>
          </div>
        </section>

        <section className="surface browser-layout__viewport">
          <div className="surface__header">
            <p className="surface__eyebrow">Viewport</p>
            <h2 className="surface__title">Dedicated browsing mode</h2>
          </div>
          <div className="placeholder-card placeholder-card--tall">
            <strong>Manual testing stays first-class</strong>
            <p>
              This page will host the persistent manual browser and keep it
              separate from any automation browser contexts.
            </p>
          </div>
        </section>
      </div>
    </section>
  )
}
