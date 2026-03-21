type ToolConfig = {
  icon: string
  extractDetail: (metadata: any) => string
}

// Extract command or path from Codex item metadata
// Codex sends: { item: { type, id, command?, path?, text? } }
function codexCommand(m: any): string {
  return m?.item?.command ?? m?.item?.exec?.join(" ") ?? ""
}

function codexPath(m: any): string {
  return m?.item?.path ?? m?.item?.file_path ?? ""
}

const TOOL_MAP: Record<string, ToolConfig> = {
  // Claude tool names
  bash:               { icon: "terminal", extractDetail: (m) => m?.input?.command ?? codexCommand(m) },
  Read:               { icon: "file",     extractDetail: (m) => m?.input?.file_path ?? codexPath(m) },
  Edit:               { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? codexPath(m) },
  Write:              { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? codexPath(m) },
  Grep:               { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  Glob:               { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  WebSearch:          { icon: "globe",    extractDetail: (m) => m?.input?.query ?? "" },
  WebFetch:           { icon: "globe",    extractDetail: (m) => m?.input?.url ?? "" },
  // Codex item types
  commandExecution:   { icon: "terminal", extractDetail: (m) => codexCommand(m) },
  command_execution:  { icon: "terminal", extractDetail: (m) => codexCommand(m) },
  fileChange:         { icon: "pencil",   extractDetail: (m) => codexPath(m) },
  file_change:        { icon: "pencil",   extractDetail: (m) => codexPath(m) },
  fileRead:           { icon: "file",     extractDetail: (m) => codexPath(m) },
  file_read:          { icon: "file",     extractDetail: (m) => codexPath(m) },
  // Special tool types
  AskUserQuestion:    { icon: "question", extractDetail: (m) => m?.input?.question ?? m?.input?.text ?? "" },
  Skill:              { icon: "skill",    extractDetail: (m) => m?.input?.skill ?? "" },
}

const FILTERED_LABELS = new Set(["command_output", "file_change_output"])

export function getToolConfig(label: string): ToolConfig {
  return TOOL_MAP[label] ?? {
    icon: "tool",
    extractDetail: (m) => {
      if (!m) return label
      // Try common fields
      const item = m?.item
      if (item) {
        return item.command ?? item.path ?? item.file_path ?? item.text?.slice(0, 60) ?? label
      }
      const firstVal = Object.values(m).find((v) => typeof v === "string")
      return (firstVal as string) ?? label
    },
  }
}

export function shouldFilterToolEvent(label: string): boolean {
  return FILTERED_LABELS.has(label)
}

export function extractToolId(metadata: any): string | null {
  return metadata?.id ?? metadata?.item?.id ?? null
}

/**
 * Normalize a Codex item type to a display-friendly label.
 * e.g., "commandExecution" → "Command", "fileChange" → "File change"
 */
export function normalizeToolLabel(label: string): string {
  const LABEL_MAP: Record<string, string> = {
    commandExecution: "Command",
    command_execution: "Command",
    fileChange: "File change",
    file_change: "File change",
    fileRead: "File read",
    file_read: "File read",
    bash: "bash",
    Read: "Read",
    Edit: "Edit",
    Write: "Write",
    Grep: "Grep",
    Glob: "Glob",
    WebSearch: "Web search",
    WebFetch: "Web fetch",
  }
  return LABEL_MAP[label] ?? label
}
