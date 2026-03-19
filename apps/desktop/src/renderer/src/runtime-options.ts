export type RuntimeProvider = "claude" | "codex"

export const RUNTIME_PROVIDER_LABELS: Record<RuntimeProvider, string> = {
  claude: "Claude",
  codex: "Codex",
}

export const RUNTIME_MODELS_BY_PROVIDER: Record<RuntimeProvider, string[]> = {
  claude: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
  codex: ["gpt-5.4"],
}

export function getModelsForRuntimeProvider(
  provider: RuntimeProvider,
): string[] {
  return RUNTIME_MODELS_BY_PROVIDER[provider]
}

export function getDefaultModelForRuntimeProvider(
  provider: RuntimeProvider,
): string {
  return RUNTIME_MODELS_BY_PROVIDER[provider][0] ?? ""
}
