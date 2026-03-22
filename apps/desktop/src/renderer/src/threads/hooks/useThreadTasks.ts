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

const TASK_TOOL_NAMES = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"])

/**
 * Derives task checklist state from TodoWrite/TaskCreate/TaskUpdate tool calls
 * in the coordinator's event stream.
 *
 * These arrive as tool_activity events with label "TodoWrite"/"TaskCreate"/"TaskUpdate"
 * and metadata.input containing the task data.
 *
 * SDK task_started/task_progress/task_notification events are NOT used —
 * those track subagent dispatches, not plan-level tasks.
 */
export function useThreadTasks(
  turnEvents: ThreadTurnEventSnapshot[],
  persistedEvents?: Array<{ eventType: string; payload: Record<string, unknown> }>,
): ThreadTasksState {
  return useMemo(() => {
    const taskMap = new Map<string, TaskItem>()

    // Load persisted tool_activity events for TodoWrite/TaskCreate/TaskUpdate (history)
    if (persistedEvents) {
      for (const evt of persistedEvents) {
        if (evt.eventType === "coordinator.tool_activity") {
          processToolEvent(taskMap, evt.payload)
        }
      }
    }

    // Apply live turn events — look for tool_activity with TodoWrite/TaskCreate/TaskUpdate
    for (const event of turnEvents) {
      if (event.eventType !== "tool_activity") continue
      processToolEvent(taskMap, event.payload)
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

function processToolEvent(
  taskMap: Map<string, TaskItem>,
  payload: Record<string, unknown>,
): void {
  const label = payload.label as string | undefined
  if (!label || !TASK_TOOL_NAMES.has(label)) return

  const metadata = payload.metadata as Record<string, unknown> | undefined
  if (!metadata) return
  const input = metadata.input as Record<string, unknown> | undefined
  if (!input) return

  if (label === "TodoWrite") {
    // TodoWrite replaces the entire task list
    // input.todos is an array of { id, content, status, priority }
    const todos = input.todos as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(todos)) return

    // Clear and rebuild from TodoWrite (it's a full replacement)
    taskMap.clear()
    for (const todo of todos) {
      const id = String(todo.id ?? "")
      if (!id) continue
      const content = String(todo.content ?? todo.subject ?? "Task")
      const rawStatus = String(todo.status ?? "pending")
      const status = mapTodoStatus(rawStatus)
      taskMap.set(id, { id, description: content, status })
    }
  } else if (label === "TaskCreate") {
    // TaskCreate adds a single task
    const id = String(input.id ?? input.taskId ?? `task_${taskMap.size + 1}`)
    const description = String(input.subject ?? input.description ?? "Task")
    taskMap.set(id, { id, description, status: "pending" })
  } else if (label === "TaskUpdate") {
    // TaskUpdate modifies a single task
    const id = String(input.taskId ?? input.id ?? "")
    if (!id) return
    const existing = taskMap.get(id)
    if (!existing) return

    const newStatus = input.status as string | undefined
    taskMap.set(id, {
      ...existing,
      ...(input.subject ? { description: String(input.subject) } : {}),
      ...(newStatus ? { status: mapTodoStatus(newStatus) } : {}),
    })
  }
}

function mapTodoStatus(raw: string): TaskItem["status"] {
  switch (raw) {
    case "in_progress":
      return "running"
    case "completed":
    case "done":
      return "completed"
    case "failed":
      return "failed"
    case "stopped":
    case "cancelled":
    case "canceled":
    case "deleted":
      return "stopped"
    default:
      return "pending"
  }
}
