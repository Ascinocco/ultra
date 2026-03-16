import { parseTerminalSessionsEvent } from "@ultra/shared"
import { useEffect } from "react"

import { AppShell } from "./components/AppShell.js"
import { EnvironmentReadinessGate } from "./components/EnvironmentReadinessGate.js"
import { FoundationStartupErrorGate } from "./components/FoundationStartupErrorGate.js"
import { SystemToolsPanel } from "./components/SystemToolsPanel.js"
import { classifyFoundationStartupFailure } from "./foundation/foundation-startup.js"
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

function TerminalSessionsBridge() {
  const connectionStatus = useAppStore((state) => state.app.connectionStatus)
  const capabilities = useAppStore((state) => state.app.capabilities)
  const activeProjectId = useAppStore((state) => state.app.activeProjectId)
  const setTerminalSessionsForProject = useAppStore(
    (state) => state.actions.setTerminalSessionsForProject,
  )

  useEffect(() => {
    if (
      connectionStatus !== "connected" ||
      !capabilities?.supportsSubscriptions ||
      !activeProjectId
    ) {
      return
    }

    let cancelled = false
    let cleanupPromise: Promise<(() => Promise<void>) | undefined> | null = null

    cleanupPromise = window.ultraShell
      .ipcSubscribe("terminal.sessions", {
        project_id: activeProjectId,
      })
      .then(({ subscriptionId }) => {
        const unsubscribeEvent = window.ultraShell.onIpcSubscriptionEvent(
          (event) => {
            if (event.event_name !== "terminal.sessions") {
              return
            }

            const parsed = parseTerminalSessionsEvent(event)

            if (
              !cancelled &&
              parsed.subscription_id === subscriptionId &&
              parsed.payload.project_id === activeProjectId
            ) {
              setTerminalSessionsForProject(
                activeProjectId,
                parsed.payload.sessions,
              )
            }
          },
        )

        return async () => {
          unsubscribeEvent()
          await window.ultraShell.ipcUnsubscribe(subscriptionId)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true

      void cleanupPromise?.then((cleanup) => cleanup?.())
    }
  }, [
    activeProjectId,
    capabilities?.supportsSubscriptions,
    connectionStatus,
    setTerminalSessionsForProject,
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
  const backendStatus = useAppStore((state) => state.app.backendStatus)
  const foundationFailure = classifyFoundationStartupFailure(backendStatus)

  async function handleRecheck() {
    setReadinessChecking()

    try {
      const snapshot = await recheckEnvironmentReadiness()
      setReadinessSnapshot(snapshot)
    } catch (error) {
      setReadinessError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleRetryStartup() {
    await window.ultraShell.retryBackendStartup()
  }

  const showReadinessGate =
    !foundationFailure &&
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
      {foundationFailure ? (
        <FoundationStartupErrorGate
          failure={foundationFailure}
          onOpenSystemTools={() => {
            setSystemToolsOpen(true)
          }}
          onRetryStartup={() => {
            void handleRetryStartup()
          }}
        />
      ) : showReadinessGate ? (
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
      <TerminalSessionsBridge />
      <AppScreen />
    </AppStoreProvider>
  )
}
