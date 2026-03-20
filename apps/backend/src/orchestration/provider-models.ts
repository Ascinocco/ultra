import type { AgentType } from "./agent-registry.js"

type Provider = "claude" | "openai" | "google" | string

const MODEL_MAP: Record<string, Record<AgentType, string>> = {
  claude: { lead: "opus", builder: "sonnet", scout: "haiku", reviewer: "sonnet" },
  openai: { lead: "o3", builder: "gpt-4o", scout: "gpt-4o-mini", reviewer: "gpt-4o" },
  google: { lead: "gemini-pro", builder: "gemini-pro", scout: "gemini-flash", reviewer: "gemini-pro" },
}

const DEFAULT_MAPPING = MODEL_MAP["claude"] as Record<AgentType, string>

export function getModelForAgent(provider: Provider, agentType: AgentType): string {
  const mapping: Record<AgentType, string> = MODEL_MAP[provider] ?? DEFAULT_MAPPING
  return mapping[agentType]
}
