type ToolConfig = {
  icon: string
  extractDetail: (metadata: any) => string
}

const TOOL_MAP: Record<string, ToolConfig> = {
  bash:      { icon: "terminal", extractDetail: (m) => m?.input?.command ?? m?.item?.command ?? "" },
  Read:      { icon: "file",     extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Edit:      { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Write:     { icon: "pencil",   extractDetail: (m) => m?.input?.file_path ?? m?.item?.path ?? "" },
  Grep:      { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  Glob:      { icon: "search",   extractDetail: (m) => m?.input?.pattern ?? "" },
  WebSearch: { icon: "globe",    extractDetail: (m) => m?.input?.query ?? "" },
  WebFetch:  { icon: "globe",    extractDetail: (m) => m?.input?.url ?? "" },
}

const FILTERED_LABELS = new Set(["command_output", "file_change"])

export function getToolConfig(label: string): ToolConfig {
  return TOOL_MAP[label] ?? {
    icon: "tool",
    extractDetail: (m) => {
      if (!m) return label
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
