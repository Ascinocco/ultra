import type { CSSProperties } from "react"

import { getShellTitle } from "./title.js"

const sectionStyle = {
  display: "grid",
  gap: "0.5rem",
} satisfies CSSProperties

export function App() {
  const ultraShell = window.ultraShell

  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: "2.5rem",
        background: "#0b1020",
        color: "#f8fafc",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <section style={sectionStyle}>
        <p
          style={{
            margin: 0,
            fontSize: "0.8rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#94a3b8",
          }}
        >
          ULR-5 scaffold
        </p>
        <h1 style={{ margin: 0, fontSize: "2.5rem" }}>{getShellTitle()}</h1>
        <p style={{ margin: 0, maxWidth: "48rem", color: "#cbd5e1" }}>
          Desktop shell, backend shell, and shared package wiring now live in a
          real pnpm workspace. Feature work starts in the next tickets.
        </p>
      </section>
      <section
        style={{
          ...sectionStyle,
          marginTop: "2rem",
          padding: "1rem 1.25rem",
          borderRadius: "1rem",
          background: "rgba(15, 23, 42, 0.7)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
        }}
      >
        <strong style={{ fontSize: "1rem" }}>Shell Versions</strong>
        {ultraShell ? (
          <>
            <span>App: {ultraShell.appName}</span>
            <span>Electron: {ultraShell.electronVersion}</span>
            <span>Node: {ultraShell.nodeVersion}</span>
            <span>Chrome: {ultraShell.chromeVersion}</span>
          </>
        ) : (
          <span>Preload bridge unavailable. Check the Electron preload path.</span>
        )}
      </section>
    </main>
  )
}
