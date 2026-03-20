import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  BLOCKED_INTERACTIVE_TOOLS,
  BLOCKED_NATIVE_TOOLS,
  DANGEROUS_BASH_PATTERNS,
  SAFE_BASH_PREFIXES,
  WRITE_TOOLS,
} from "./guard-rules.js"

/**
 * Agent types that are read-only and must not modify project files.
 * Only "builder" and "merger" are allowed to write files.
 */
const READ_ONLY_AGENT_TYPES = new Set(["scout", "reviewer"])

/**
 * Env var guard prefix for hook commands.
 *
 * When hooks are deployed to a worktree, they affect ALL Claude Code sessions
 * in that directory. This prefix ensures hooks only activate for Ultra-managed
 * agent sessions (which have ULTRA_AGENT=true set in their environment) and
 * are no-ops for the user's own Claude Code session.
 */
const ENV_GUARD = '[ "$ULTRA_AGENT" != "true" ] && exit 0;'

/**
 * Marker comment embedded in every generated hook command.
 * Used to identify and strip stale Ultra hooks during settings merge.
 */
const HOOK_MARKER = "# ultra-orchestration-hook"

/** Hook entry shape matching Claude Code's settings.local.json format. */
interface HookEntry {
  matcher: string
  command: string
}

/**
 * Escape a string for use inside a single-quoted POSIX shell string.
 *
 * POSIX single-quoted strings cannot contain single quotes at all.
 * The standard technique is to end the single-quoted segment, emit an escaped
 * single quote using $'\'', then start a new single-quoted segment:
 *   'it'\''s fine'  →  it's fine
 */
function escapeForSingleQuotedShell(str: string): string {
  return str.replace(/'/g, "'\\''")
}

/**
 * Build a PreToolUse guard that blocks a specific tool.
 *
 * Returns a JSON response with decision=block so Claude Code rejects
 * the tool call before execution.
 */
function blockGuard(toolName: string, reason: string): HookEntry {
  const response = JSON.stringify({ decision: "block", reason })
  return {
    matcher: toolName,
    command: `${HOOK_MARKER} ${ENV_GUARD} echo '${escapeForSingleQuotedShell(response)}'`,
  }
}

/**
 * Build a PreToolUse guard script that validates file paths are within
 * the agent's worktree boundary.
 *
 * Applied to Write, Edit, and NotebookEdit tools. Uses the
 * ULTRA_WORKTREE_PATH env var to determine the allowed path boundary.
 *
 * @param filePathField - The JSON field name containing the file path
 *   ("file_path" for Write/Edit, "notebook_path" for NotebookEdit)
 */
function buildPathBoundaryGuardScript(filePathField: string): string {
  return [
    HOOK_MARKER,
    ENV_GUARD,
    '[ -z "$ULTRA_WORKTREE_PATH" ] && exit 0;',
    "read -r INPUT;",
    `FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"${filePathField}": *"\\([^"]*\\)".*/\\1/p');`,
    '[ -z "$FILE_PATH" ] && exit 0;',
    'case "$FILE_PATH" in /*) ;; *) FILE_PATH="$(pwd)/$FILE_PATH" ;; esac;',
    'case "$FILE_PATH" in "$ULTRA_WORKTREE_PATH"/*) exit 0 ;; "$ULTRA_WORKTREE_PATH") exit 0 ;; esac;',
    'echo \'{"decision":"block","reason":"Path boundary violation: file is outside your assigned worktree. All writes must target files within your worktree."}\';',
  ].join(" ")
}

/**
 * Generate PreToolUse guards that enforce worktree path boundaries.
 *
 * Returns guards for Write (file_path), Edit (file_path), and
 * NotebookEdit (notebook_path). Applied to ALL agent types as
 * defense-in-depth.
 */
function getPathBoundaryGuards(): HookEntry[] {
  return [
    { matcher: "Write", command: buildPathBoundaryGuardScript("file_path") },
    { matcher: "Edit", command: buildPathBoundaryGuardScript("file_path") },
    { matcher: "NotebookEdit", command: buildPathBoundaryGuardScript("notebook_path") },
  ]
}

/**
 * Build a PreToolUse guard script that inspects the Bash command for
 * dangerous operations: git push, git reset --hard, and wrong branch naming.
 *
 * @param branchName - The agent's assigned branch, used for naming validation
 */
function buildDangerGuardScript(branchName: string): string {
  return [
    HOOK_MARKER,
    ENV_GUARD,
    "read -r INPUT;",
    'CMD=$(echo "$INPUT" | sed \'s/.*"command": *"\\([^"]*\\)".*/\\1/\');',
    "if echo \"$CMD\" | grep -qE '\\bgit\\s+push\\b'; then",
    '  echo \'{"decision":"block","reason":"git push is blocked — integrate changes through the Ultra orchestrator"}\';',
    "  exit 0;",
    "fi;",
    "if echo \"$CMD\" | grep -qE 'git\\s+reset\\s+--hard'; then",
    '  echo \'{"decision":"block","reason":"git reset --hard is not allowed — it destroys uncommitted work"}\';',
    "  exit 0;",
    "fi;",
    "if echo \"$CMD\" | grep -qE 'git\\s+checkout\\s+-b\\s'; then",
    `  BRANCH=$(echo "$CMD" | sed 's/.*git\\s*checkout\\s*-b\\s*\\([^ ]*\\).*/\\1/');`,
    `  if ! echo "$BRANCH" | grep -qE '^${escapeForSingleQuotedShell(branchName).replace(/\//g, "\\/")}'; then`,
    `    echo '{"decision":"block","reason":"Branch must follow ultra/ naming convention"}';`,
    "    exit 0;",
    "  fi;",
    "fi;",
  ].join(" ")
}

/**
 * Generate Bash-level PreToolUse guards for dangerous operations.
 * Applied to ALL agent types.
 *
 * @param branchName - The agent's assigned branch name
 */
function getDangerGuards(branchName: string): HookEntry[] {
  return [{ matcher: "Bash", command: buildDangerGuardScript(branchName) }]
}

/**
 * Build a Bash guard script that blocks file-modifying commands for
 * read-only agents (scout, reviewer).
 *
 * Uses a whitelist-first approach: if the command matches a known-safe prefix,
 * it passes. Otherwise, it checks against dangerous patterns and blocks if any match.
 *
 * @param agentType - The agent type, included in block reason messages
 */
function buildBashFileGuardScript(agentType: string): string {
  const safePrefixChecks = SAFE_BASH_PREFIXES.map(
    (prefix) => `if echo "$CMD" | grep -qE '^\\s*${prefix}'; then exit 0; fi;`,
  ).join(" ")

  const dangerPattern = DANGEROUS_BASH_PATTERNS.join("|")

  return [
    HOOK_MARKER,
    ENV_GUARD,
    "read -r INPUT;",
    'CMD=$(echo "$INPUT" | sed \'s/.*"command": *"\\([^"]*\\)".*/\\1/\');',
    safePrefixChecks,
    `if echo "$CMD" | grep -qE '${dangerPattern}'; then`,
    `  echo '{"decision":"block","reason":"${agentType} agents cannot modify files — this command is not allowed"}';`,
    "  exit 0;",
    "fi;",
  ].join(" ")
}

/**
 * Generate capability-specific PreToolUse guards.
 *
 * Read-only agents (scout, reviewer) get:
 * - Write, Edit, NotebookEdit tool blocks
 * - Bash file-modification command guards
 *
 * All agents get:
 * - Native team/task tool blocks (Agent, Task, TeamCreate, etc.)
 * - Interactive tool blocks (AskUserQuestion, EnterPlanMode, EnterWorktree)
 */
function getCapabilityGuards(agentType: string): HookEntry[] {
  const guards: HookEntry[] = []

  // Block native team/task tools for ALL agents
  const nativeToolGuards = BLOCKED_NATIVE_TOOLS.map((tool) =>
    blockGuard(tool, `Ultra agents must not use ${tool} directly — use the orchestration layer`),
  )
  guards.push(...nativeToolGuards)

  // Block interactive tools for ALL agents
  const interactiveGuards = BLOCKED_INTERACTIVE_TOOLS.map((tool) =>
    blockGuard(
      tool,
      `${tool} requires human interaction — agents run non-interactively. Escalate to the orchestrator instead`,
    ),
  )
  guards.push(...interactiveGuards)

  // Read-only agents: block write tools and dangerous bash
  if (READ_ONLY_AGENT_TYPES.has(agentType)) {
    const writeToolGuards = WRITE_TOOLS.map((tool) =>
      blockGuard(tool, `${agentType} agents cannot modify files — ${tool} is not allowed`),
    )
    guards.push(...writeToolGuards)

    guards.push({
      matcher: "Bash",
      command: buildBashFileGuardScript(agentType),
    })
  }

  return guards
}

/**
 * Check whether a hook entry is Ultra-managed.
 *
 * Ultra hook commands always contain the HOOK_MARKER comment or reference
 * ULTRA_ env vars. User hooks will not contain these patterns.
 */
function isUltraHookEntry(entry: HookEntry): boolean {
  return (
    entry.command.includes(HOOK_MARKER) ||
    entry.command.includes("ULTRA_AGENT") ||
    entry.command.includes("ULTRA_WORKTREE_PATH")
  )
}

/** Options for deployHooks. */
export interface DeployHooksOptions {
  agentType: string
  agentId: string
  branchName: string
}

/**
 * Deploy hooks config to an agent's worktree as `.claude/settings.local.json`.
 *
 * Generates PreToolUse guards appropriate for the agent type, then merges
 * them into the worktree's settings file. Existing user hooks and non-hooks
 * settings (permissions, env, etc.) are preserved. Stale Ultra hook entries
 * (identified by the ultra-orchestration-hook marker) are stripped and replaced.
 *
 * Ultra hooks are placed before user hooks so security guards run first.
 *
 * @param worktreePath - Absolute path to the agent's git worktree
 * @param options - Agent type, ID, and branch name for guard generation
 */
export function deployHooks(worktreePath: string, options: DeployHooksOptions): void {
  const { agentType, branchName } = options

  // Generate all guards for this agent
  const pathGuards = getPathBoundaryGuards()
  const dangerGuards = getDangerGuards(branchName)
  const capabilityGuards = getCapabilityGuards(agentType)
  const allGuards = [...pathGuards, ...dangerGuards, ...capabilityGuards]

  const claudeDir = join(worktreePath, ".claude")
  mkdirSync(claudeDir, { recursive: true })

  const outputPath = join(claudeDir, "settings.local.json")

  // Read existing settings.local.json to preserve user hooks and non-hooks keys
  let existingConfig: Record<string, unknown> = {}
  try {
    const existingContent = readFileSync(outputPath, "utf-8")
    existingConfig = JSON.parse(existingContent) as Record<string, unknown>
  } catch {
    // File does not exist or is malformed — start fresh
  }

  // Separate non-hooks keys (permissions, env, $schema, etc.) from hooks
  const { hooks: existingHooksRaw, ...nonHooksKeys } = existingConfig

  // Partition existing hooks: keep user entries, discard stale Ultra entries
  const existingHooks = (existingHooksRaw ?? {}) as Record<string, HookEntry[]>
  const userHooks: Record<string, HookEntry[]> = {}
  for (const [eventType, entries] of Object.entries(existingHooks)) {
    const userEntries = entries.filter((e) => !isUltraHookEntry(e))
    if (userEntries.length > 0) {
      userHooks[eventType] = userEntries
    }
  }

  // Build new hooks config: Ultra guards in PreToolUse
  const newHooks: Record<string, HookEntry[]> = {
    PreToolUse: allGuards,
  }

  // Merge: Ultra hooks first (security guards must run first), then user hooks
  const mergedHooks: Record<string, HookEntry[]> = {}
  const allEventTypes = new Set([...Object.keys(newHooks), ...Object.keys(userHooks)])
  for (const eventType of allEventTypes) {
    const ultraEntries = newHooks[eventType] ?? []
    const userEntries = userHooks[eventType] ?? []
    mergedHooks[eventType] = [...ultraEntries, ...userEntries]
  }

  const finalConfig = { ...nonHooksKeys, hooks: mergedHooks }
  const finalContent = `${JSON.stringify(finalConfig, null, 2)}\n`

  writeFileSync(outputPath, finalContent, "utf-8")
}
