import type { FoundationStartupFailure } from "../foundation/foundation-startup.js"

export function FoundationStartupErrorGate({
  failure,
  onRetryStartup,
  onOpenSystemTools,
}: {
  failure: FoundationStartupFailure
  onRetryStartup: () => void
  onOpenSystemTools: () => void
}) {
  return (
    <main className="foundation-startup-gate">
      <section className="foundation-startup-gate__card">
        <header className="foundation-startup-gate__header">
          <p className="surface__eyebrow">Foundation startup</p>
          <h1 className="foundation-startup-gate__title">{failure.title}</h1>
          <p className="foundation-startup-gate__summary">{failure.summary}</p>
          <p className="foundation-startup-gate__meta">
            Failure kind: {failure.kind}
          </p>
          <p className="foundation-startup-gate__recovery">
            {failure.recovery}
          </p>
        </header>

        <div className="foundation-startup-gate__actions">
          <button
            className="foundation-startup-gate__button"
            type="button"
            onClick={onRetryStartup}
          >
            Retry Startup
          </button>
          <button
            className="foundation-startup-gate__button foundation-startup-gate__button--ghost"
            type="button"
            onClick={onOpenSystemTools}
          >
            Open System &amp; Tools
          </button>
        </div>
      </section>
    </main>
  )
}
