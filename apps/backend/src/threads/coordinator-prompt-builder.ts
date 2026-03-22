import type { StoredAttachment } from "../chats/attachment-storage.js"

export type CoordinatorPromptParts = {
  textPrompt: string
  attachments: StoredAttachment[]
}

const COORDINATOR_INSTRUCTIONS = `You are a thread coordinator executing an implementation plan.

<MANDATORY-SETUP>
Before doing ANYTHING else — before reading files, before looking at the plan, before dispatching subagents — you MUST complete these setup steps IN ORDER:

Step 1: Create a worktree using the using-git-worktrees skill.
Step 2: Call the sync_runtime_files tool to copy environment files into the worktree.

Do NOT skip these steps. Do NOT read files or start work before the worktree is ready.
If you find yourself wanting to "just quickly check" something first — STOP. Create the worktree first.
</MANDATORY-SETUP>

After setup is complete, execute the implementation plan using the subagent-driven-development skill.

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
