/**
 * Tiered conflict resolution for merging agent branches.
 *
 * Implements a 4-tier escalation strategy:
 *   1. Clean merge — git merge with no conflicts
 *   2. Auto-resolve — parse conflict markers, keep incoming (agent) changes
 *   3. AI-resolve — use resolveWithAI callback to resolve remaining conflicts
 *   4. Re-imagine — abort merge, fetch both clean versions, call resolveWithAI
 *
 * Each tier is attempted in order. If a tier fails, the next is tried.
 * A simple FIFO merge queue serializes concurrent merges per thread.
 *
 * Ported from vendor/overstory/src/merge/resolver.ts (Bun -> Node.js).
 */

import { execFile } from "node:child_process"
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises"
import { promisify } from "node:util"
import { MergeError } from "./orchestration-errors.js"

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MergeResult = {
  success: boolean
  tier: number
  conflictFiles?: string[]
  error?: string
}

export type ResolveWithAI = (prompt: string, context: string) => Promise<string>

export type MergeContext = {
  taskSummary: string
  /** Optional thread ID used to key the FIFO merge queue. */
  threadId?: string
}

// ---------------------------------------------------------------------------
// Internal git helper
// ---------------------------------------------------------------------------

/**
 * Run a git command and return stdout/stderr/exitCode without throwing.
 * We need exit-code-aware results for merge operations (exit 1 = conflict,
 * not always an error).
 */
async function runGit(
  repoRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: repoRoot })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number | string }
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? (err instanceof Error ? err.message : String(err)),
      exitCode: typeof error.code === "number" ? error.code : 1,
    }
  }
}

// ---------------------------------------------------------------------------
// Conflict marker helpers
// ---------------------------------------------------------------------------

/**
 * Parse conflict markers in file content and keep the incoming (agent) changes.
 *
 * Conflict block format:
 * ```
 * <<<<<<< HEAD
 * canonical content
 * =======
 * incoming content
 * >>>>>>> branch
 * ```
 *
 * Returns the resolved content, or null if no conflict markers were found.
 */
function resolveConflictsKeepIncoming(content: string): string | null {
  const conflictPattern = /^<{7} .+\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7} .+\n?/gm

  if (!conflictPattern.test(content)) {
    return null
  }

  // Reset lastIndex after test()
  conflictPattern.lastIndex = 0

  return content.replace(conflictPattern, (_match, _canonical: string, incoming: string) => {
    return incoming
  })
}

/**
 * Parse conflict markers and keep ALL lines from both sides (union strategy).
 * Used when the file has `merge=union` gitattribute.
 * Returns the resolved content, or null if no conflict markers were found.
 */
function resolveConflictsUnion(content: string): string | null {
  const conflictPattern = /^<{7} .+\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7} .+\n?/gm

  if (!conflictPattern.test(content)) {
    return null
  }

  conflictPattern.lastIndex = 0

  return content.replace(conflictPattern, (_match, canonical: string, incoming: string) => {
    return canonical + incoming
  })
}

/**
 * Detect if any conflict block has non-whitespace content on the canonical (HEAD) side.
 * Returns true if auto-resolving with keep-incoming would silently discard canonical content.
 * CRITICAL safety check — use before resolveConflictsKeepIncoming to prevent data loss.
 */
export function hasContentfulCanonical(content: string): boolean {
  const conflictPattern = /^<{7} .+\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7} .+\n?/gm
  let match = conflictPattern.exec(content)
  while (match !== null) {
    const canonical = match[1] ?? ""
    if (canonical.trim().length > 0) {
      return true
    }
    match = conflictPattern.exec(content)
  }
  return false
}

/**
 * Check if a file has the `merge=union` gitattribute set.
 */
async function checkMergeUnion(repoRoot: string, filePath: string): Promise<boolean> {
  const { stdout, exitCode } = await runGit(repoRoot, ["check-attr", "merge", "--", filePath])
  if (exitCode !== 0) return false
  return stdout.trim().endsWith(": merge: union")
}

// ---------------------------------------------------------------------------
// Prose safety validator
// ---------------------------------------------------------------------------

/**
 * Check if text looks like conversational prose rather than code.
 * Returns true if the output is likely an LLM explanation rather than resolved file content.
 * Used to prevent accidentally writing AI chat output to source files.
 */
export function looksLikeProse(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true

  // Common conversational opening patterns from LLMs
  const prosePatterns = [
    /^(I |I'[a-z]+ |Here |Here's |The |This |Let me |Sure|Unfortunately|Apologies|Sorry)/i,
    /^(To resolve|Looking at|Based on|After reviewing|The conflict)/i,
    /^```/m, // Markdown fencing — the model wrapped the code
    /I need permission/i,
    /I cannot/i,
    /I don't have/i,
  ]

  for (const pattern of prosePatterns) {
    if (pattern.test(trimmed)) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Conflict file detection
// ---------------------------------------------------------------------------

async function getConflictedFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await runGit(repoRoot, ["diff", "--name-only", "--diff-filter=U"])
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
}

// ---------------------------------------------------------------------------
// Dirty working tree helpers
// ---------------------------------------------------------------------------

async function checkDirtyWorkingTree(repoRoot: string): Promise<string[]> {
  const { stdout: unstaged } = await runGit(repoRoot, ["diff", "--name-only"])
  const { stdout: staged } = await runGit(repoRoot, ["diff", "--name-only", "--cached"])
  const files = [
    ...unstaged
      .trim()
      .split("\n")
      .filter((l) => l.length > 0),
    ...staged
      .trim()
      .split("\n")
      .filter((l) => l.length > 0),
  ]
  return [...new Set(files)]
}

// ---------------------------------------------------------------------------
// Tier 1: Clean merge
// ---------------------------------------------------------------------------

async function tryCleanMerge(
  branch: string,
  repoRoot: string,
): Promise<{ success: boolean; conflictFiles: string[] }> {
  const { exitCode } = await runGit(repoRoot, ["merge", "--no-edit", branch])

  if (exitCode === 0) {
    return { success: true, conflictFiles: [] }
  }

  const conflictFiles = await getConflictedFiles(repoRoot)
  return { success: false, conflictFiles }
}

// ---------------------------------------------------------------------------
// Tier 2: Auto-resolve
// ---------------------------------------------------------------------------

async function tryAutoResolve(
  conflictFiles: string[],
  repoRoot: string,
): Promise<{ success: boolean; remainingConflicts: string[] }> {
  const remainingConflicts: string[] = []

  for (const file of conflictFiles) {
    const filePath = `${repoRoot}/${file}`

    try {
      const content = await fsReadFile(filePath, "utf8")
      const isUnion = await checkMergeUnion(repoRoot, file)

      // For non-union files, if canonical side has content auto-resolving would
      // silently discard it — escalate to higher tier.
      if (!isUnion && hasContentfulCanonical(content)) {
        remainingConflicts.push(file)
        continue
      }

      const resolved = isUnion
        ? resolveConflictsUnion(content)
        : resolveConflictsKeepIncoming(content)

      if (resolved === null) {
        remainingConflicts.push(file)
        continue
      }

      await fsWriteFile(filePath, resolved, "utf8")
      const { exitCode } = await runGit(repoRoot, ["add", file])
      if (exitCode !== 0) {
        remainingConflicts.push(file)
      }
    } catch {
      remainingConflicts.push(file)
    }
  }

  if (remainingConflicts.length > 0) {
    return { success: false, remainingConflicts }
  }

  // All files resolved — commit
  const { exitCode } = await runGit(repoRoot, ["commit", "--no-edit"])
  return { success: exitCode === 0, remainingConflicts }
}

// ---------------------------------------------------------------------------
// Tier 3: AI-resolve
// ---------------------------------------------------------------------------

async function tryAiResolve(
  conflictFiles: string[],
  repoRoot: string,
  taskSummary: string,
  resolveWithAI: ResolveWithAI,
): Promise<{ success: boolean; remainingConflicts: string[] }> {
  const remainingConflicts: string[] = []

  for (const file of conflictFiles) {
    const filePath = `${repoRoot}/${file}`

    try {
      const content = await fsReadFile(filePath, "utf8")
      const prompt = [
        "You are a merge conflict resolver. Output ONLY the resolved file content.",
        "Rules: NO explanation, NO markdown fencing, NO conversation, NO preamble.",
        "Output the raw file content as it should appear on disk.",
        "Choose the best combination of both sides of this conflict.",
      ].join(" ")

      const context = `Task: ${taskSummary}\n\nFile: ${file}\n\n${content}`

      let resolved: string
      try {
        resolved = await resolveWithAI(prompt, context)
      } catch {
        remainingConflicts.push(file)
        continue
      }

      if (resolved.trim() === "") {
        remainingConflicts.push(file)
        continue
      }

      // Validate output is code, not prose — fall back to next tier if not
      if (looksLikeProse(resolved)) {
        remainingConflicts.push(file)
        continue
      }

      await fsWriteFile(filePath, resolved, "utf8")
      const { exitCode: addExitCode } = await runGit(repoRoot, ["add", file])
      if (addExitCode !== 0) {
        remainingConflicts.push(file)
      }
    } catch {
      remainingConflicts.push(file)
    }
  }

  if (remainingConflicts.length > 0) {
    return { success: false, remainingConflicts }
  }

  // All files resolved — commit
  const { exitCode } = await runGit(repoRoot, ["commit", "--no-edit"])
  return { success: exitCode === 0, remainingConflicts }
}

// ---------------------------------------------------------------------------
// Tier 4: Re-imagine
// ---------------------------------------------------------------------------

async function tryReimagine(
  branch: string,
  conflictFiles: string[],
  repoRoot: string,
  taskSummary: string,
  resolveWithAI: ResolveWithAI,
): Promise<{ success: boolean }> {
  // Abort the current merge first
  await runGit(repoRoot, ["merge", "--abort"])

  for (const file of conflictFiles) {
    try {
      // Get canonical (HEAD/current branch) version
      const { stdout: canonicalContent, exitCode: catCanonicalCode } = await runGit(repoRoot, [
        "show",
        `HEAD:${file}`,
      ])

      // Get the incoming branch version
      const { stdout: branchContent, exitCode: catBranchCode } = await runGit(repoRoot, [
        "show",
        `${branch}:${file}`,
      ])

      if (catCanonicalCode !== 0 || catBranchCode !== 0) {
        return { success: false }
      }

      const prompt = [
        "You are a merge conflict resolver. Output ONLY the final file content.",
        "Rules: NO explanation, NO markdown fencing, NO conversation, NO preamble.",
        "Output the raw file content as it should appear on disk.",
        "Reimplement the changes from the branch version onto the canonical version.",
      ].join(" ")

      const context = [
        `Task: ${taskSummary}`,
        `\n\n=== CANONICAL VERSION (HEAD) ===\n`,
        canonicalContent,
        `\n\n=== BRANCH VERSION (${branch}) ===\n`,
        branchContent,
      ].join("")

      let reimagined: string
      try {
        reimagined = await resolveWithAI(prompt, context)
      } catch {
        return { success: false }
      }

      if (reimagined.trim() === "") {
        return { success: false }
      }

      // Validate output is code, not prose
      if (looksLikeProse(reimagined)) {
        return { success: false }
      }

      const filePath = `${repoRoot}/${file}`
      await fsWriteFile(filePath, reimagined, "utf8")
      const { exitCode: addExitCode } = await runGit(repoRoot, ["add", file])
      if (addExitCode !== 0) {
        return { success: false }
      }
    } catch {
      return { success: false }
    }
  }

  // Commit the reimagined changes
  const { exitCode } = await runGit(repoRoot, ["commit", "-m", `Reimagine merge: ${branch}`])

  return { success: exitCode === 0 }
}

// ---------------------------------------------------------------------------
// Merge queue — FIFO per thread
// ---------------------------------------------------------------------------

const mergeQueues = new Map<string, Promise<void>>()

function enqueue(threadId: string, fn: () => Promise<void>): Promise<void> {
  const existing = mergeQueues.get(threadId) ?? Promise.resolve()
  const next = existing.then(fn, fn) // always proceed even if previous failed
  mergeQueues.set(threadId, next)
  // Clean up entry once the whole chain settles
  next.finally(() => {
    if (mergeQueues.get(threadId) === next) {
      mergeQueues.delete(threadId)
    }
  })
  return next
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMergeResolver(options: { resolveWithAI?: ResolveWithAI }): {
  merge: (repoRoot: string, branch: string, context: MergeContext) => Promise<MergeResult>
} {
  const { resolveWithAI } = options

  async function doMerge(
    repoRoot: string,
    branch: string,
    context: MergeContext,
  ): Promise<MergeResult> {
    const { taskSummary } = context

    // Pre-flight: stash any dirty tracked files so git merge can proceed
    let didStash = false
    const dirtyFiles = await checkDirtyWorkingTree(repoRoot)
    if (dirtyFiles.length > 0) {
      const { exitCode: stashCode } = await runGit(repoRoot, [
        "stash",
        "push",
        "-m",
        "ultra-merge: auto-stash dirty files",
      ])
      if (stashCode !== 0) {
        throw new MergeError(
          `Working tree has uncommitted changes: ${dirtyFiles.join(", ")}. Commit or stash before merging.`,
          { branchName: branch },
        )
      }
      didStash = true
    }

    try {
      // Tier 1: Clean merge
      const cleanResult = await tryCleanMerge(branch, repoRoot)
      if (cleanResult.success) {
        return { success: true, tier: 1, conflictFiles: [] }
      }

      let conflictFiles = cleanResult.conflictFiles

      // Tier 2: Auto-resolve (keep incoming, skip if canonical has content)
      const autoResult = await tryAutoResolve(conflictFiles, repoRoot)
      if (autoResult.success) {
        return { success: true, tier: 2, conflictFiles }
      }
      conflictFiles = autoResult.remainingConflicts

      // Tier 3: AI-resolve (requires resolveWithAI callback)
      if (resolveWithAI !== undefined) {
        const aiResult = await tryAiResolve(conflictFiles, repoRoot, taskSummary, resolveWithAI)
        if (aiResult.success) {
          return { success: true, tier: 3, conflictFiles }
        }
        conflictFiles = aiResult.remainingConflicts

        // Tier 4: Re-imagine (abort merge, fetch both versions, ask AI again)
        const reimagineResult = await tryReimagine(
          branch,
          conflictFiles,
          repoRoot,
          taskSummary,
          resolveWithAI,
        )
        if (reimagineResult.success) {
          return { success: true, tier: 4, conflictFiles: [] }
        }

        return {
          success: false,
          tier: 4,
          conflictFiles,
          error: "All resolution tiers failed (last: reimagine)",
        }
      }

      // No AI callback — abort merge and report failure at tier 3
      try {
        await runGit(repoRoot, ["merge", "--abort"])
      } catch {
        // best-effort
      }

      return {
        success: false,
        tier: 3,
        conflictFiles,
        error: "Conflicts require AI resolution but no resolveWithAI callback was provided",
      }
    } finally {
      if (didStash) {
        await runGit(repoRoot, ["stash", "pop"])
      }
    }
  }

  return {
    merge(repoRoot, branch, context) {
      const threadId = context.threadId ?? "default"
      let result!: MergeResult
      let error: unknown

      return enqueue(threadId, async () => {
        try {
          result = await doMerge(repoRoot, branch, context)
        } catch (e) {
          error = e
        }
      }).then(() => {
        if (error !== undefined) throw error
        return result
      })
    },
  }
}
