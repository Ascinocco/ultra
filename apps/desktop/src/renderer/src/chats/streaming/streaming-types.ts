export type ToolEntryStatus = "running" | "done" | "error"

export type ToolEntry = {
  id: string
  toolName: string
  detail: string
  icon: string
  status: ToolEntryStatus
  subtype?: string
}

export type StreamingBlock =
  | { type: "text"; content: string }
  | { type: "tool_group"; id: string; tools: ToolEntry[]; collapsed: boolean }
