import { useMemo } from "react"
import type { ThreadTurnEventSnapshot } from "@ultra/shared"

export type TaskItem = {
  id: string
  description: string
  status: "pending" | "running" | "completed" | "failed" | "stopped"
  summary?: string
}

export type ThreadTasksState = {
  tasks: TaskItem[]
  percentage: number
  hasAnyTasks: boolean
  allComplete: boolean
  hasFailed: boolean
}

export function useThreadTasks(
  turnEvents: ThreadTurnEventSnapshot[],
  persistedEvents?: Array<{ eventType: string; payload: Record<string, unknown> }>,
): ThreadTasksState {
  return useMemo(() => {
    const taskMap = new Map<string, TaskItem>()

    // Load persisted coordinator.task_update events (history)
    if (persistedEvents) {
      for (const evt of persistedEvents) {
        if (evt.eventType === "coordinator.task_update") {
          const p = evt.payload as { label?: string; metadata?: Record<string, unknown> }
          if (p.label && p.metadata) {
            applyTaskEvent(taskMap, p.label, p.metadata)
          }
        }
      }
    }

    // Apply live turn events — only SDK task lifecycle events, not agent dispatches
    for (const event of turnEvents) {
      if (event.eventType !== "task_update") continue
      const payload = event.payload as { label?: string; metadata?: Record<string, unknown> }
      if (!payload.label || !payload.metadata) continue
      // Skip agent/subagent dispatch tasks — only show plan-level tasks
      const taskType = payload.metadata.taskType as string | undefined
      if (taskType === "agent" || taskType === "subprocess") continue
      applyTaskEvent(taskMap, payload.label, payload.metadata)
    }

    const tasks = Array.from(taskMap.values())
    const terminalStatuses = new Set(["completed", "failed", "stopped"])
    const finishedCount = tasks.filter((t) => terminalStatuses.has(t.status)).length
    const percentage = tasks.length > 0 ? Math.round((finishedCount / tasks.length) * 100) : 0
    const allComplete = tasks.length > 0 && tasks.every((t) => terminalStatuses.has(t.status))
    const hasFailed = tasks.some((t) => t.status === "failed" || t.status === "stopped")

    return { tasks, percentage, hasAnyTasks: tasks.length > 0, allComplete, hasFailed }
  }, [turnEvents, persistedEvents])
}

function applyTaskEvent(
  taskMap: Map<string, TaskItem>,
  label: string,
  metadata: Record<string, unknown>,
): void {
  const taskId = metadata.taskId as string | undefined
  if (!taskId) return

  const existing = taskMap.get(taskId)

  if (label === "task_started") {
    const summary = existing?.summary
    taskMap.set(taskId, {
      id: taskId,
      description: (metadata.description as string) ?? existing?.description ?? "Task",
      status: "running",
      ...(summary != null && { summary }),
    })
  } else if (label === "task_progress") {
    const summary = (metadata.summary as string | undefined) ?? existing?.summary
    taskMap.set(taskId, {
      id: taskId,
      description: (metadata.description as string) ?? existing?.description ?? "Task",
      status: existing?.status ?? "running",
      ...(summary != null && { summary }),
    })
  } else if (label === "task_notification") {
    const status = metadata.status as string
    const summary = (metadata.summary as string | undefined) ?? existing?.summary
    taskMap.set(taskId, {
      id: taskId,
      description: existing?.description ?? "Task",
      status: (status as TaskItem["status"]) ?? "completed",
      ...(summary != null && { summary }),
    })
  }
}
