import { useState, useEffect, useRef, useCallback } from "react"
import type { TaskItem } from "./hooks/useThreadTasks.js"

type Props = {
  tasks: TaskItem[]
  percentage: number
  allComplete: boolean
  hasFailed: boolean
}

const AUTO_DISMISS_MS = 60_000

function ChevronUp() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 6L8 2L13 6" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="14" height="7" viewBox="0 0 16 8" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 2L8 6L13 2" />
    </svg>
  )
}

export function ThreadTaskDrawer({ tasks, percentage, allComplete, hasFailed }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      setDismissed(true)
    }, AUTO_DISMISS_MS)
  }, [clearTimer])

  // Auto-dismiss: start timer when all complete + not failed + collapsed
  useEffect(() => {
    if (allComplete && !hasFailed && !expanded) {
      startTimer()
    } else {
      clearTimer()
    }
    return clearTimer
  }, [allComplete, hasFailed, expanded, startTimer, clearTimer])

  // Reset dismissed if new tasks appear (multi-run)
  useEffect(() => {
    if (!allComplete) {
      setDismissed(false)
    }
  }, [allComplete])

  if (dismissed || tasks.length === 0) return null

  const percentColor = hasFailed || percentage < 50 ? "#f0c674" : "#6ee7b7"

  if (!expanded) {
    return (
      <div className="task-drawer__lip" onClick={() => setExpanded(true)}>
        <ChevronUp />
        <span className="task-drawer__pct" style={{ color: percentColor }}>
          ({percentage}%)
        </span>
      </div>
    )
  }

  return (
    <div className="task-drawer__bar">
      <div className="task-drawer__header" onClick={() => setExpanded(false)}>
        <ChevronDown />
        <span className="task-drawer__pct" style={{ color: percentColor }}>
          ({percentage}%)
        </span>
      </div>
      <div className="task-drawer__list">
        {tasks.map((task) => (
          <div key={task.id} className={`task-drawer__item task-drawer__item--${task.status}`}>
            <span className="task-drawer__icon">
              {task.status === "completed" && "\u2713"}
              {task.status === "running" && "\u25CF"}
              {(task.status === "failed" || task.status === "stopped") && "\u2717"}
              {task.status === "pending" && "\u25CB"}
            </span>
            <span className="task-drawer__desc">{task.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
