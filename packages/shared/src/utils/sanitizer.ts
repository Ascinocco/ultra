const PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[a-zA-Z0-9_-]+/g, "[REDACTED]"],
  [/github_pat_[a-zA-Z0-9_]+/g, "[REDACTED]"],
  [/ghp_[a-zA-Z0-9]+/g, "[REDACTED]"],
  [/(Bearer\s+)\S+/g, "$1[REDACTED]"],
  [/(ANTHROPIC_API_KEY=)\S+/g, "$1[REDACTED]"],
  [/(OPENAI_API_KEY=)\S+/g, "$1[REDACTED]"],
  [/(GOOGLE_API_KEY=)\S+/g, "$1[REDACTED]"],
]

export function sanitize(input: string): string {
  let result = input
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

export function sanitizeObject(obj: unknown): unknown {
  if (typeof obj === "string") return sanitize(obj)
  if (Array.isArray(obj)) return obj.map(sanitizeObject)
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObject(value)
    }
    return result
  }
  return obj
}
