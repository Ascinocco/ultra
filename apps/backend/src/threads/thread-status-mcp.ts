import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import type { ThreadService } from "./thread-service.js"

export function createThreadStatusMcpServer(
  threadService: ThreadService,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "ultra-thread-status",
    version: "1.0.0",
    tools: [
      tool(
        "get_thread_status",
        "Get the current status of a thread coordinator, including execution state, recent activity, and message summary. Use this to check on thread progress.",
        { thread_id: z.string().describe("The thread ID to check status for") },
        async (args) => {
          try {
            const detail = threadService.getThread(args.thread_id)
            const thread = detail.thread

            const { events } = threadService.getEvents(args.thread_id)
            const { messages } = threadService.getMessages(args.thread_id)
            const recentMessages = messages.slice(-10)

            const lines: string[] = []
            lines.push(`# Thread: ${thread.title}`)
            lines.push("")
            lines.push(`**Execution State:** ${thread.executionState}`)
            lines.push(`**Review State:** ${thread.reviewState}`)
            if (thread.branchName)
              lines.push(`**Branch:** ${thread.branchName}`)
            if (thread.prUrl) lines.push(`**PR:** ${thread.prUrl}`)
            if (thread.failureReason)
              lines.push(`**Failure Reason:** ${thread.failureReason}`)
            lines.push(`**Created:** ${thread.createdAt}`)
            if (thread.lastActivityAt)
              lines.push(`**Last Activity:** ${thread.lastActivityAt}`)
            lines.push(`**Restart Count:** ${thread.restartCount}`)
            lines.push("")

            if (thread.summary) {
              lines.push("## Summary")
              lines.push(thread.summary)
              lines.push("")
            }

            if (recentMessages.length > 0) {
              lines.push(
                `## Recent Messages (last ${recentMessages.length})`,
              )
              for (const msg of recentMessages) {
                const role =
                  msg.role === "coordinator"
                    ? "Coordinator"
                    : msg.role === "user"
                      ? "User"
                      : "System"
                const text =
                  msg.content.text.length > 200
                    ? `${msg.content.text.slice(0, 200)}...`
                    : msg.content.text
                lines.push(`- **${role}** (${msg.messageType}): ${text}`)
              }
              lines.push("")
            }

            const recentEvents = events.slice(-10)
            if (recentEvents.length > 0) {
              lines.push(`## Recent Events (last ${recentEvents.length})`)
              for (const evt of recentEvents) {
                lines.push(`- [${evt.eventType}] ${evt.occurredAt}`)
              }
              lines.push("")
            }

            lines.push("## Aggregate")
            lines.push(`- Total events: ${events.length}`)
            lines.push(`- Total messages: ${messages.length}`)
            lines.push(
              `- Coordinator messages: ${messages.filter((m) => m.role === "coordinator").length}`,
            )
            lines.push(
              `- User messages: ${messages.filter((m) => m.role === "user").length}`,
            )

            return {
              content: [{ type: "text" as const, text: lines.join("\n") }],
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return {
              content: [
                { type: "text" as const, text: `Error: ${message}` },
              ],
              isError: true,
            }
          }
        },
      ),
    ],
  })
}
