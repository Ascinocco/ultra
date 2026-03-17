import { FitAddon } from "@xterm/addon-fit"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Terminal } from "xterm"
import "xterm/css/xterm.css"

import type { TerminalCommandGenEvent } from "@ultra/shared"

import { useAppStore } from "../state/app-store.js"
import { TerminalCommandBar } from "./TerminalCommandBar.js"
import {
  generateCommand,
  injectCommand,
} from "./terminal-command-gen-workflows.js"
import { terminalOutputEmitter } from "./terminal-output-emitter.js"
import { subscribeToTerminalOutput } from "./terminal-subscriptions.js"

export function TerminalPane({
  sessionId,
  projectId,
  recentOutput,
  onInput,
  onResize,
}: {
  sessionId: string
  projectId: string
  recentOutput: string
  onInput: (sessionId: string, data: string) => void
  onResize: (sessionId: string, cols: number, rows: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const unsubRef = useRef<(() => Promise<void>) | null>(null)

  const [commandBarVisible, setCommandBarVisible] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [streamingText, setStreamingText] = useState("")
  const [error, setError] = useState<string | null>(null)

  const sessionCwd = useAppStore((s) => {
    const sessions = s.terminal.sessionsByProjectId[projectId] ?? []
    const session = sessions.find((sess) => sess.sessionId === sessionId)
    return session?.cwd ?? ""
  })
  const provider = useAppStore((s) => s.terminal.commandBarProvider)
  const model = useAppStore((s) => s.terminal.commandBarModel)
  const setProvider = useAppStore((s) => s.actions.setCommandBarProvider)
  const setModel = useAppStore((s) => s.actions.setCommandBarModel)
  const hasClaude = useAppStore(
    (s) =>
      s.readiness.snapshot?.checks?.some(
        (c) => c.tool === "claude" && c.status === "ready",
      ) ?? false,
  )
  const hasCodex = useAppStore(
    (s) =>
      s.readiness.snapshot?.checks?.some(
        (c) => c.tool === "codex" && c.status === "ready",
      ) ?? false,
  )
  const availableProviders = useMemo(() => {
    const p: Array<"claude" | "codex"> = []
    if (hasClaude) p.push("claude")
    if (hasCodex) p.push("codex")
    return p.length > 0 ? p : (["claude"] as Array<"claude" | "codex">)
  }, [hasClaude, hasCodex])

  const handleCmdK = useCallback(
    (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "k") {
        e.preventDefault()
        if (!commandBarVisible && !generating) {
          setCommandBarVisible(true)
        }
      }
    },
    [commandBarVisible, generating],
  )

  const handleSubmit = useCallback(
    async (prompt: string) => {
      setGenerating(true)
      setStreamingText("")
      setError(null)

      try {
        const unsub = await generateCommand(
          {
            projectId,
            prompt,
            cwd: sessionCwd,
            recentOutput: recentOutput ?? "",
            provider,
            model,
            sessionId,
          },
          (event: TerminalCommandGenEvent) => {
            if (event.type === "delta") {
              setStreamingText((prev) => prev + event.text)
            } else if (event.type === "complete") {
              setGenerating(false)
              setCommandBarVisible(false)
              void injectCommand(projectId, sessionId, event.command)
            } else if (event.type === "error") {
              setGenerating(false)
              setError(event.message)
            }
          },
        )
        unsubRef.current = unsub
      } catch (err) {
        setGenerating(false)
        setError(
          err instanceof Error ? err.message : "Failed to start generation",
        )
      }
    },
    [projectId, sessionId, sessionCwd, recentOutput, provider, model],
  )

  const handleCancel = useCallback(() => {
    if (unsubRef.current) {
      void unsubRef.current()
      unsubRef.current = null
    }
    setCommandBarVisible(false)
    setGenerating(false)
    setStreamingText("")
    setError(null)
  }, [])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    wrapper.addEventListener("keydown", handleCmdK)
    return () => wrapper.removeEventListener("keydown", handleCmdK)
  }, [handleCmdK])

  // biome-ignore lint/correctness/useExhaustiveDependencies: effect runs once per session mount; recentOutput/onInput/onResize are intentionally captured at mount time
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let mounted = true

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#1a1d27",
        foreground: "#eef1f8",
        cursor: "#eef1f8",
        selectionBackground: "rgba(91, 141, 239, 0.3)",
        black: "#1a1d27",
        brightBlack: "#8494b0",
        white: "#eef1f8",
        brightWhite: "#ffffff",
        blue: "#5b8def",
        brightBlue: "#7aa5ff",
        cyan: "#6ee7b7",
        brightCyan: "#6ee7b7",
        green: "#6ee7b7",
        brightGreen: "#6ee7b7",
        red: "#fb7185",
        brightRed: "#fb7185",
        yellow: "#facc15",
        brightYellow: "#facc15",
        magenta: "#c084fc",
        brightMagenta: "#c084fc",
      },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    // Write buffered output for session continuity
    if (recentOutput) {
      terminal.write(recentOutput)
    }

    // Fit terminal to container and report size
    try {
      fitAddon.fit()
      onResize(sessionId, terminal.cols, terminal.rows)
    } catch {
      // fit() can throw if container has zero dimensions
    }

    // User keystrokes → backend
    const inputDisposable = terminal.onData((data) => {
      onInput(sessionId, data)
    })

    // Output from backend → xterm
    const outputHandler = (chunk: string) => {
      terminal.write(chunk)
    }
    terminalOutputEmitter.on(sessionId, outputHandler)

    // Subscribe to terminal.output for this session
    let unsubscribeOutput: (() => Promise<void>) | null = null
    void subscribeToTerminalOutput(projectId, sessionId).then((unsub) => {
      if (mounted) {
        unsubscribeOutput = unsub
      } else {
        void unsub()
      }
    })

    // ResizeObserver for container size changes
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit()
          onResize(sessionId, terminal.cols, terminal.rows)
        } catch {
          // Ignore fit errors on zero-dimension containers
        }
      }, 50)
    })
    resizeObserver.observe(container)

    terminalRef.current = terminal

    return () => {
      mounted = false
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      inputDisposable.dispose()
      terminalOutputEmitter.off(sessionId, outputHandler)
      terminal.dispose()
      terminalRef.current = null

      if (unsubscribeOutput) {
        void unsubscribeOutput()
      }
    }
  }, [sessionId, projectId])

  return (
    <div className="terminal-pane" ref={wrapperRef}>
      <div className="terminal-pane__xterm" ref={containerRef} />
      <TerminalCommandBar
        visible={commandBarVisible}
        provider={provider}
        model={model}
        generating={generating}
        streamingText={streamingText}
        error={error}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        onProviderChange={setProvider}
        onModelChange={setModel}
        availableProviders={availableProviders}
      />
    </div>
  )
}
