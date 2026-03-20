type SummaryMessage = {
  role: string
  content: string
}

const MAX_MESSAGE_LENGTH = 500
const SUMMARY_SYSTEM_PROMPT = `You are generating a workspace description for a coding session sidebar.
Output ONLY a single line, max 80 characters. No quotes, no explanation.
Include ticket number if referenced (e.g., "ULR-93: ...").
Focus on the high-level goal, not individual steps.
Only change the description if the session's focus has meaningfully shifted.
If the focus hasn't changed, return the current description unchanged.`

export function buildSummaryPrompt(
  currentDescription: string | null,
  recentMessages: SummaryMessage[],
): string {
  const truncated = recentMessages.map((m) => ({
    role: m.role,
    content:
      m.content.length > MAX_MESSAGE_LENGTH
        ? m.content.slice(0, MAX_MESSAGE_LENGTH) + "..."
        : m.content,
  }))

  const messagesText = truncated
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n")

  return `Current description: ${currentDescription ?? "None yet"}

Recent messages:
${messagesText}

Write the workspace description now:`
}

export function getSystemPrompt(): string {
  return SUMMARY_SYSTEM_PROMPT
}

export function selectSummaryModel(chatProvider: "codex" | "claude"): {
  provider: "codex" | "claude"
  model: string
} {
  if (chatProvider === "claude") {
    return { provider: "claude", model: "claude-haiku-4-5-20251001" }
  }
  return { provider: "codex", model: "codex-mini-latest" }
}
