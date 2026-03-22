import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk"
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { z } from "zod"
import type { SandboxPersistenceService } from "../sandboxes/sandbox-persistence-service.js"
import type { ProjectService } from "../projects/project-service.js"
import type { ThreadService } from "./thread-service.js"

/**
 * Creates an in-process MCP server with tools for the thread coordinator.
 * Registered on thread sessions only — main chat does NOT get these tools.
 */
export function createThreadToolsMcpServer(
  sandboxPersistenceService: SandboxPersistenceService,
  projectService: ProjectService,
  threadService: ThreadService,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "ultra-thread-tools",
    version: "1.0.0",
    tools: [
      tool(
        "sync_runtime_files",
        "Sync whitelisted runtime files (like .env) from the project root into a worktree directory. Call this AFTER creating a worktree to ensure environment configuration is available. The whitelist is configured per-project (default: .env).",
        {
          project_id: z.string().describe("The project ID"),
          worktree_path: z.string().describe("Absolute path to the worktree directory"),
        },
        async (args) => {
          try {
            // Get the project root path
            const project = projectService.get(args.project_id)
            const projectRoot = project.rootPath
            if (!projectRoot) {
              return {
                content: [{ type: "text" as const, text: "Error: Project has no root path configured." }],
                isError: true,
              }
            }

            // Get the whitelisted runtime file paths
            const profile = sandboxPersistenceService.getRuntimeProfile(args.project_id)
            const filePaths = profile.runtimeFilePaths

            if (filePaths.length === 0) {
              return {
                content: [{ type: "text" as const, text: "No runtime files configured for sync. Default is .env — configure via project settings." }],
              }
            }

            // Validate worktree path exists
            if (!existsSync(args.worktree_path)) {
              return {
                content: [{ type: "text" as const, text: `Error: Worktree path does not exist: ${args.worktree_path}` }],
                isError: true,
              }
            }

            // Copy each whitelisted path (files or directories)
            const copied: string[] = []
            const missing: string[] = []
            const errors: string[] = []

            for (const filePath of filePaths) {
              // Validate: no absolute paths, no directory traversal
              if (filePath.startsWith("/") || filePath.includes("..")) {
                errors.push(`Invalid path (absolute or traversal): ${filePath}`)
                continue
              }

              const sourcePath = join(projectRoot, filePath)

              if (!existsSync(sourcePath)) {
                missing.push(filePath)
                continue
              }

              try {
                const stat = statSync(sourcePath)
                if (stat.isDirectory()) {
                  // Recursively copy directory
                  const files = copyDirRecursive(sourcePath, join(args.worktree_path, filePath))
                  for (const f of files) {
                    copied.push(join(filePath, relative(sourcePath, f)))
                  }
                } else {
                  const targetPath = join(args.worktree_path, filePath)
                  mkdirSync(dirname(targetPath), { recursive: true })
                  copyFileSync(sourcePath, targetPath)
                  copied.push(filePath)
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                errors.push(`Failed to copy ${filePath}: ${msg}`)
              }
            }

            // Build result
            const lines: string[] = []
            lines.push(`## Runtime Files Sync`)
            lines.push(`Source: ${projectRoot}`)
            lines.push(`Target: ${args.worktree_path}`)
            lines.push("")

            if (copied.length > 0) {
              lines.push(`**Copied (${copied.length}):** ${copied.join(", ")}`)
            }
            if (missing.length > 0) {
              lines.push(`**Missing in source (${missing.length}):** ${missing.join(", ")}`)
            }
            if (errors.length > 0) {
              lines.push(`**Errors (${errors.length}):**`)
              for (const err of errors) {
                lines.push(`- ${err}`)
              }
            }

            if (copied.length === 0 && missing.length === filePaths.length) {
              lines.push("\nNo files were copied — none of the whitelisted files exist in the project root.")
            }

            return {
              content: [{ type: "text" as const, text: lines.join("\n") }],
              isError: errors.length > 0,
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true,
            }
          }
        },
      ),
      tool(
        "set_thread_status",
        "Update the current thread's execution status. Call this when you have finished all implementation tasks to mark the thread as awaiting review. Valid statuses: awaiting_review, blocked.",
        {
          thread_id: z.string().describe("The thread ID"),
          status: z.enum(["awaiting_review", "blocked"]).describe("The new execution status"),
        },
        async (args) => {
          try {
            threadService.updateExecutionState(args.thread_id, args.status, null)
            return {
              content: [{ type: "text" as const, text: `Thread status updated to: ${args.status}` }],
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true,
            }
          }
        },
      ),
    ],
  })
}

function copyDirRecursive(src: string, dest: string): string[] {
  const copied: string[] = []
  mkdirSync(dest, { recursive: true })

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      copied.push(...copyDirRecursive(srcPath, destPath))
    } else {
      copyFileSync(srcPath, destPath)
      copied.push(srcPath)
    }
  }

  return copied
}
