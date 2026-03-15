import { APP_NAME, buildPlaceholderProjectLabel } from "@ultra/shared"

export function getShellTitle(): string {
  return buildPlaceholderProjectLabel(APP_NAME)
}
