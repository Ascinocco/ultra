export const APP_NAME = "Ultra"
export const PLACEHOLDER_PROJECT_ID = "placeholder-project"

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "degraded"
  | "disconnected"

export function buildPlaceholderProjectLabel(projectName: string): string {
  return `${projectName} workspace`
}
