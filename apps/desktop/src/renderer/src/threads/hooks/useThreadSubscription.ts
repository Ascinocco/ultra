import { useEffect, useRef } from "react"

import type { AppActions } from "../../state/app-store.js"
import { fetchThreadMessages, subscribeToThreadMessages } from "../thread-workflows.js"

type SubscriptionActions = Pick<AppActions, "appendMessage" | "setMessagesForThread">

export function useThreadSubscription(
  threadId: string | null,
  actions: SubscriptionActions,
): void {
  const unsubscribeRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!threadId) return

    // Fetch current messages first
    void fetchThreadMessages(threadId, actions)

    // Then subscribe for live updates
    void subscribeToThreadMessages(threadId, actions).then((unsub) => {
      unsubscribeRef.current = unsub
    })

    return () => {
      if (unsubscribeRef.current) {
        void unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [threadId])
}
