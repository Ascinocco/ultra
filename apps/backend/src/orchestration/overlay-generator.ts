import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

export type OverlayConfig = {
  agentType: "lead" | "builder" | "scout" | "reviewer"
  agentId: string
  threadId: string
  branchName: string
  worktreePath: string
  taskDescription: string
  fileScope: string[]
  parentAgentId: string | null
  qualityGates: Array<{ name: string; command: string }>
}

export function generateOverlay(config: OverlayConfig): string {
  const baseDef = readFileSync(
    join(__dirname, "agent-defs", `${config.agentType}.md`),
    "utf-8",
  )
  const template = readFileSync(
    join(__dirname, "templates", "overlay.md.tmpl"),
    "utf-8",
  )

  // Substitute placeholders
  let result = template
  result = result.replace(/\{\{BASE_DEFINITION\}\}/g, baseDef)
  result = result.replace(/\{\{AGENT_ID\}\}/g, config.agentId)
  result = result.replace(/\{\{THREAD_ID\}\}/g, config.threadId)
  result = result.replace(/\{\{BRANCH_NAME\}\}/g, config.branchName)
  result = result.replace(/\{\{WORKTREE_PATH\}\}/g, config.worktreePath)
  result = result.replace(/\{\{PARENT_AGENT_ID\}\}/g, config.parentAgentId ?? "none")
  result = result.replace(/\{\{TASK_DESCRIPTION\}\}/g, config.taskDescription)
  result = result.replace(
    /\{\{FILE_SCOPE\}\}/g,
    config.fileScope.length > 0
      ? config.fileScope.map((f) => `- \`${f}\``).join("\n")
      : "No file scope restriction",
  )
  result = result.replace(
    /\{\{QUALITY_GATES\}\}/g,
    config.qualityGates.length > 0
      ? config.qualityGates.map((g) => `- **${g.name}:** \`${g.command}\``).join("\n")
      : "No quality gates defined",
  )

  // Spawn instructions only for leads
  const spawnSection =
    config.agentType === "lead"
      ? `## Spawning Sub-Agents\n\nRequest sub-agent spawns via stdout:\n\`\`\`json\n{"type": "spawn_agent", "agent_type": "builder|scout|reviewer", "task": "description", "file_scope": ["paths"]}\n\`\`\`\n\nThe backend will create the agent. You'll see their results merged into your branch.`
      : ""
  result = result.replace(/\{\{SPAWN_INSTRUCTIONS\}\}/g, spawnSection)

  return result
}
