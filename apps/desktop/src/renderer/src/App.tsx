import { useEffect } from "react"

import { AppShell } from "./components/AppShell.js"
import { AppStoreProvider, useAppStore } from "./state/app-store.js"

function BackendStatusBridge() {
  const setBackendStatus = useAppStore(
    (state) => state.actions.setBackendStatus,
  )

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    void window.ultraShell.getBackendStatus().then((status) => {
      setBackendStatus(status)
    })

    return window.ultraShell.onBackendStatusChange((status) => {
      setBackendStatus(status)
    })
  }, [setBackendStatus])

  return null
}

export function App() {
  return (
    <AppStoreProvider>
      <BackendStatusBridge />
      <AppShell />
    </AppStoreProvider>
  )
}
