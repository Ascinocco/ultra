import type { StoredAttachment } from "../chats/attachment-storage.js"

export type CoordinatorPromptParts = {
  textPrompt: string
  attachments: StoredAttachment[]
}

const COORDINATOR_INSTRUCTIONS = `You are a thread coordinator executing an implementation plan.

## Execution Order (STRICT — follow this sequence exactly)

1. **Create worktree** — Use the using-git-worktrees skill to create an isolated worktree. Do NOT skip this step.
2. **Sync environment files** — Call the sync_runtime_files tool to copy .env and other whitelisted config files into the worktree. Do NOT skip this step.
3. **Read the plan from disk** — Read the implementation plan file from the artifacts/context provided. Understand all tasks before starting.
4. **Execute tasks** — Use the subagent-driven-development skill to implement the plan task-by-task.

## Rules
- Do NOT re-plan. The plan is final. Execute it as written.
- Use test-driven-development for each task implementation.
- Use verification-before-completion before claiming any task is done.
- Use systematic-debugging if you encounter failures.
- Report progress as you complete each task.
- If you hit a blocker, describe it clearly and wait for guidance.

`

export function buildCoordinatorPrompt(seedContextJson: string): CoordinatorPromptParts {
  const seedContext = JSON.parse(seedContextJson) as {
    messages?: Array<{
      id: string
      role: string
      messageType: string
      content: string | null
      attachments?: Array<{ type: string; name: string; media_type: string; data: string }>
    }>
    artifacts?: Array<{ type: string; path: string; content: string }>
  }

  const parts: string[] = [COORDINATOR_INSTRUCTIONS]
  const allAttachments: StoredAttachment[] = []

  // Format messages
  if (seedContext.messages && seedContext.messages.length > 0) {
    parts.push("## Planning Context\n\n### Conversation\n")
    for (const msg of seedContext.messages) {
      if (!msg.content) continue
      if (msg.messageType?.startsWith("plan_marker") || msg.messageType === "thread_start_request") continue
      const label = msg.role === "user" ? "user" : "assistant"
      parts.push(`[${label}]: ${msg.content}\n`)

      if (msg.attachments) {
        for (const att of msg.attachments) {
          allAttachments.push({
            type: att.type as "image" | "text",
            name: att.name,
            media_type: att.media_type,
            data: att.data,
          })
        }
      }
    }
  }

  // Format artifacts
  if (seedContext.artifacts && seedContext.artifacts.length > 0) {
    parts.push("\n### Artifacts\n")
    for (const artifact of seedContext.artifacts) {
      parts.push(`--- ${artifact.path} ---\n${artifact.content}\n`)
    }
  }

  parts.push("\nBegin execution now.")

  return {
    textPrompt: parts.join("\n"),
    attachments: allAttachments,
  }
}
