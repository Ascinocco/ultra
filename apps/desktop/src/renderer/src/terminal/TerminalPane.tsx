import { FitAddon } from "@xterm/addon-fit"
import { useEffect, useRef } from "react"
import { Terminal } from "xterm"
import "xterm/css/xterm.css"

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
  const terminalRef = useRef<Terminal | null>(null)

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
  }, [sessionId, projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  // recentOutput, onInput, onResize are intentionally excluded —
  // the effect runs once per session mount and captures initial values.

  return (
    <div className="terminal-pane">
      <div className="terminal-pane__xterm" ref={containerRef} />
    </div>
  )
}
