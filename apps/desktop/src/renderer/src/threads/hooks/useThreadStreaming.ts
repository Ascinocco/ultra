import type { ThreadMessageSnapshot } from "@ultra/shared"

export function mergeStreamingMessages(
  existing: ThreadMessageSnapshot[],
  incoming: ThreadMessageSnapshot,
): ThreadMessageSnapshot[] {
  const idx = existing.findIndex((m) => m.id === incoming.id)
  if (idx >= 0) {
    return existing.map((m, i) => (i === idx ? incoming : m))
  }
  return [...existing, incoming]
}
