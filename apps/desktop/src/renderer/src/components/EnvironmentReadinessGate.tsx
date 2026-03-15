import type { EnvironmentReadinessSnapshot } from "@ultra/shared"

export function EnvironmentReadinessGate({
  snapshot,
  status,
  error,
  onRecheck,
  onOpenSystemTools,
}: {
  snapshot: EnvironmentReadinessSnapshot | null
  status: "checking" | "blocked" | "error"
  error: string | null
  onRecheck: () => void
  onOpenSystemTools: () => void
}) {
  const headline =
    status === "checking"
      ? "Checking required tools"
      : "Ultra needs system tools before it can continue"

  const body =
    status === "checking"
      ? "Ultra completed the backend handshake and is validating the tools required for this session."
      : "One or more required CLI tools are missing, unsupported, or failed to respond."

  return (
    <main className="readiness-gate">
      <section className="readiness-gate__card">
        <header className="readiness-gate__header">
          <p className="surface__eyebrow">Startup readiness</p>
          <h1 className="readiness-gate__title">{headline}</h1>
          <p className="readiness-gate__summary">{body}</p>
          {snapshot ? (
            <p className="readiness-gate__meta">
              Session mode: {snapshot.sessionMode}
            </p>
          ) : null}
          {error ? <p className="readiness-gate__error">{error}</p> : null}
        </header>

        {snapshot ? (
          <div className="readiness-gate__checks">
            {snapshot.checks
              .filter((check) => check.requiredInCurrentSession)
              .map((check) => (
                <article
                  key={check.tool}
                  className="readiness-gate__check"
                  data-status={check.status}
                >
                  <div className="readiness-gate__check-header">
                    <strong>{check.displayName}</strong>
                    <span
                      className="readiness-gate__status"
                      data-status={check.status}
                    >
                      {check.status}
                    </span>
                  </div>
                  <p className="readiness-gate__check-command">
                    {check.command}
                  </p>
                  <p className="readiness-gate__check-help">{check.helpText}</p>
                </article>
              ))}
          </div>
        ) : null}

        <div className="readiness-gate__actions">
          <button
            className="readiness-gate__button"
            type="button"
            onClick={onRecheck}
          >
            {status === "checking" ? "Checking…" : "Recheck"}
          </button>
          <button
            className="readiness-gate__button readiness-gate__button--ghost"
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
