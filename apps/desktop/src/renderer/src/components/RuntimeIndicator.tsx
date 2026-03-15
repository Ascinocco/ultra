import type { ConnectionStatus } from "../state/app-store.js"

const statusMeta: Record<
  ConnectionStatus,
  { label: string; tone: "good" | "warn" | "bad" | "idle" }
> = {
  connecting: {
    label: "Connecting",
    tone: "warn",
  },
  connected: {
    label: "Connected",
    tone: "good",
  },
  degraded: {
    label: "Degraded",
    tone: "bad",
  },
  disconnected: {
    label: "Disconnected",
    tone: "idle",
  },
}

export function getConnectionStatusMeta(status: ConnectionStatus) {
  return statusMeta[status]
}

export function RuntimeIndicator({
  status,
  detail,
}: {
  status: ConnectionStatus
  detail?: string
}) {
  const meta = getConnectionStatusMeta(status)

  return (
    <div className="runtime-indicator">
      <span className="runtime-indicator__label">Runtime</span>
      <span
        className={`runtime-indicator__pill runtime-indicator__pill--${meta.tone}`}
      >
        <span aria-hidden="true" className="runtime-indicator__dot" />
        {meta.label}
      </span>
      {detail ? (
        <span className="runtime-indicator__detail">{detail}</span>
      ) : null}
    </div>
  )
}
