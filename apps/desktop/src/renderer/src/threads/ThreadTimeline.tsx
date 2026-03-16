import type { ThreadEventSnapshot } from "@ultra/shared"

function formatEventType(eventType: string): string {
  return eventType
    .replace("thread.", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ThreadTimeline({
  events,
  loading,
}: {
  events: ThreadEventSnapshot[]
  loading: boolean
}) {
  if (loading) {
    return <p className="thread-timeline__status">Loading timeline...</p>
  }

  if (events.length === 0) {
    return <p className="thread-timeline__status">No events yet</p>
  }

  return (
    <div className="thread-timeline">
      {events.map((event) => (
        <div key={event.eventId} className="thread-timeline__event">
          <span className="thread-timeline__event-time">
            {formatTimestamp(event.occurredAt)}
          </span>
          <span className="thread-timeline__event-type">
            {formatEventType(event.eventType)}
          </span>
          <span className="thread-timeline__event-actor">
            {event.actorType}
          </span>
        </div>
      ))}
    </div>
  )
}
