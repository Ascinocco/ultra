import type {
  DependencyCheck,
  EnvironmentReadinessSnapshot,
} from "@ultra/shared"

function sortChecks(checks: DependencyCheck[]): DependencyCheck[] {
  return [...checks].sort((left, right) => {
    if (left.requiredInCurrentSession !== right.requiredInCurrentSession) {
      return left.requiredInCurrentSession ? -1 : 1
    }

    return left.displayName.localeCompare(right.displayName)
  })
}

function ReadinessChecks({
  snapshot,
}: {
  snapshot: EnvironmentReadinessSnapshot | null
}) {
  if (!snapshot) {
    return (
      <p className="system-tools-panel__empty">
        No environment readiness data is available yet.
      </p>
    )
  }

  return (
    <div className="system-tools-panel__checks">
      {sortChecks(snapshot.checks).map((check) => (
        <article
          key={check.tool}
          className="system-tools-panel__check"
          data-status={check.status}
        >
          <div className="system-tools-panel__check-header">
            <div>
              <strong>{check.displayName}</strong>
              <p>{check.command}</p>
            </div>
            <span
              className="system-tools-panel__status"
              data-status={check.status}
            >
              {check.status}
            </span>
          </div>
          <p className="system-tools-panel__meta">
            {check.requiredInCurrentSession
              ? "Required in this session"
              : "Not required in this session"}
            {check.detectedVersion ? ` • ${check.detectedVersion}` : ""}
          </p>
          <p className="system-tools-panel__help">{check.helpText}</p>
        </article>
      ))}
    </div>
  )
}

export function SystemToolsPanel({
  open,
  snapshot,
  status,
  error,
  onClose,
  onRecheck,
}: {
  open: boolean
  snapshot: EnvironmentReadinessSnapshot | null
  status: "idle" | "checking" | "ready" | "blocked" | "error"
  error: string | null
  onClose: () => void
  onRecheck: () => void
}) {
  if (!open) {
    return null
  }

  return (
    <div className="system-tools-panel__overlay" role="presentation">
      <section
        aria-label="System & Tools"
        className="system-tools-panel"
        role="dialog"
      >
        <header className="system-tools-panel__header">
          <div>
            <p className="surface__eyebrow">Settings</p>
            <h2 className="system-tools-panel__title">System &amp; Tools</h2>
            <p className="system-tools-panel__summary">
              {snapshot
                ? `Session mode: ${snapshot.sessionMode}. Environment is ${snapshot.status}.`
                : "Ultra checks CLI prerequisites after the backend handshake."}
            </p>
          </div>
          <div className="system-tools-panel__actions">
            <button
              className="system-tools-panel__button"
              type="button"
              onClick={onRecheck}
            >
              {status === "checking" ? "Rechecking…" : "Recheck"}
            </button>
            <button
              className="system-tools-panel__button system-tools-panel__button--ghost"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>
        {error ? <p className="system-tools-panel__error">{error}</p> : null}
        <ReadinessChecks snapshot={snapshot} />
      </section>
    </div>
  )
}
