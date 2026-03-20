import type { AgentType } from "./agent-registry.js"

type Provider = "claude" | "openai" | "google" | string

const MODEL_MAP: Record<string, Record<AgentType, string>> = {
  claude: { lead: "opus", builder: "sonnet", scout: "haiku", reviewer: "sonnet" },
  openai: { lead: "o3", builder: "gpt-4o", scout: "gpt-4o-mini", reviewer: "gpt-4o" },
  google: { lead: "gemini-pro", builder: "gemini-pro", scout: "gemini-flash", reviewer: "gemini-pro" },
}

export function getModelForAgent(provider: Provider, agentType: AgentType): string {
  const mapping = MODEL_MAP[provider] ?? MODEL_MAP.claude
  return mapping[agentType]
}
