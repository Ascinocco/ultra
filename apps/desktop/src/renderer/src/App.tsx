import { useEffect } from "react"

import { AppShell } from "./components/AppShell.js"
import { EnvironmentReadinessGate } from "./components/EnvironmentReadinessGate.js"
import { SystemToolsPanel } from "./components/SystemToolsPanel.js"
import {
  loadEnvironmentReadiness,
  recheckEnvironmentReadiness,
} from "./readiness/readiness-workflows.js"
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

function EnvironmentReadinessBridge() {
  const connectionStatus = useAppStore((state) => state.app.connectionStatus)
  const setReadinessChecking = useAppStore(
    (state) => state.actions.setReadinessChecking,
  )
  const setReadinessSnapshot = useAppStore(
    (state) => state.actions.setReadinessSnapshot,
  )
  const setReadinessError = useAppStore(
    (state) => state.actions.setReadinessError,
  )
  const resetReadiness = useAppStore((state) => state.actions.resetReadiness)
  const setSystemToolsOpen = useAppStore(
    (state) => state.actions.setSystemToolsOpen,
  )

  useEffect(() => {
    return window.ultraShell.onOpenSystemTools(() => {
      setSystemToolsOpen(true)
    })
  }, [setSystemToolsOpen])

  useEffect(() => {
    if (connectionStatus !== "connected") {
      resetReadiness()
      return
    }

    let cancelled = false

    setReadinessChecking()

    void loadEnvironmentReadiness()
      .then((snapshot) => {
        if (!cancelled) {
          setReadinessSnapshot(snapshot)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReadinessError(
            error instanceof Error ? error.message : String(error),
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    connectionStatus,
    resetReadiness,
    setReadinessChecking,
    setReadinessError,
    setReadinessSnapshot,
  ])

  return null
}

function AppScreen() {
  const connectionStatus = useAppStore((state) => state.app.connectionStatus)
  const readiness = useAppStore((state) => state.readiness)
  const setReadinessChecking = useAppStore(
    (state) => state.actions.setReadinessChecking,
  )
  const setReadinessSnapshot = useAppStore(
    (state) => state.actions.setReadinessSnapshot,
  )
  const setReadinessError = useAppStore(
    (state) => state.actions.setReadinessError,
  )
  const setSystemToolsOpen = useAppStore(
    (state) => state.actions.setSystemToolsOpen,
  )

  async function handleRecheck() {
    setReadinessChecking()

    try {
      const snapshot = await recheckEnvironmentReadiness()
      setReadinessSnapshot(snapshot)
    } catch (error) {
      setReadinessError(error instanceof Error ? error.message : String(error))
    }
  }

  const showReadinessGate =
    connectionStatus === "connected" &&
    (readiness.status === "checking" ||
      readiness.status === "blocked" ||
      readiness.status === "error")
  const gateStatus: "checking" | "blocked" | "error" =
    readiness.status === "blocked" || readiness.status === "error"
      ? readiness.status
      : "checking"

  return (
    <>
      {showReadinessGate ? (
        <EnvironmentReadinessGate
          snapshot={readiness.snapshot}
          status={gateStatus}
          error={readiness.error}
          onOpenSystemTools={() => {
            setSystemToolsOpen(true)
          }}
          onRecheck={() => {
            void handleRecheck()
          }}
        />
      ) : (
        <AppShell />
      )}
      <SystemToolsPanel
        open={readiness.systemToolsOpen}
        snapshot={readiness.snapshot}
        status={readiness.status}
        error={readiness.error}
        onClose={() => {
          setSystemToolsOpen(false)
        }}
        onRecheck={() => {
          void handleRecheck()
        }}
      />
    </>
  )
}

export function App() {
  return (
    <AppStoreProvider>
      <BackendStatusBridge />
      <EnvironmentReadinessBridge />
      <AppScreen />
    </AppStoreProvider>
  )
}
