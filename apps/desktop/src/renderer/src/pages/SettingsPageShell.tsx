import { useAppStore } from "../state/app-store.js"

export function SettingsPageShell({
  onBack,
}: {
  onBack: () => void
}) {
  const app = useAppStore((state) => state.app)

  const connectionStatus = app.connectionStatus
  const isConnected = connectionStatus === "connected"

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <button
          className="settings-page__back"
          type="button"
          onClick={onBack}
          aria-label="Back to workspace"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 4L6 8l4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>
        <h1 className="settings-page__title">Settings</h1>
      </div>

      <div className="settings-page__content">
        <section className="settings-page__section">
          <h2 className="settings-page__section-title">Runtime Status</h2>
          {isConnected ? (
            <div className="settings-page__status-card">
              <div className="settings-page__status-row">
                <span className="settings-page__status-dot settings-page__status-dot--healthy" />
                <span className="settings-page__status-label">Backend</span>
                <span className="settings-page__status-value">Connected</span>
              </div>
            </div>
          ) : (
            <div className="settings-page__status-card settings-page__status-card--empty">
              <p>No active runtime</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
