# Agent Orchestration Layer

**Status:** Approved design
**Milestone:** M4 Runtime Supervision
**Replaces:** External Overstory coordinator model in `coordinator-runtime.md`
**Ported from:** `vendor/overstory/` (worktree manager, merge resolver, guard rules, hooks deployer, watchdog)

## Objective

Build a minimal agent orchestration layer directly into Ultra's backend that handles spawning coding agents in isolated git worktrees, sandboxing them via Claude Code hooks, tracking their health with progressive escalation, merging their branches back with tiered conflict resolution, and exposing structured lifecycle events to Ultra's UI.

Ultra's backend becomes the coordinator. No external orchestration process. The agent hierarchy (lead → builder/scout/reviewer) and battle-tested patterns port from overstory, adapted to Ultra's runtime (Node/Electron), database layer, and process model.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Coordinator model | Ultra backend IS the coordinator | Eliminates two-orchestrator conflict, simplifies process model |
| Agent communication | Stdout NDJSON | Already wired in existing runtime infra, zero extra dependencies |
| Sub-agent spawning | Lead requests, backend spawns | Backend owns all process lifecycle, can enforce limits and track tree |
| Concurrency limit | Up to 8 sub-agents per thread, no global limit | User manages token budget, don't throttle |
| Merge strategy | Tiers 1-4 from overstory | Clean → auto-resolve → AI-resolve → reimagine → user escalation |
| Agent sandboxing | Claude Code hooks in settings.local.json | Merge into existing settings, don't overwrite |
| Agent autonomy | --dangerously-skip-permissions (or runtime equivalent) | Maximum autonomy within sandbox boundaries |
| Model assignments | Derived from chat provider | Claude: opus/sonnet/haiku. OpenAI: o3/gpt-4o/gpt-4o-mini. Google: gemini-pro/gemini-flash |
| Thread communication | Dual surface | Direct chat in thread detail pane + relay through main chat |

## Runtime Topology

### Before (overstory model)

```
Ultra backend → spawns Overstory coordinator process (external)
                  → coordinator spawns workers internally
                  → Ultra supervises the coordinator, not the workers
```

### After (Ultra-owned)

```
Ultra backend (IS the coordinator)
  → OrchestrationService receives start_thread
  → Spawns lead agent as child process in worktree
  → Lead emits spawn requests via stdout NDJSON
  → OrchestrationService spawns sub-agents (builder/scout/reviewer)
  → OrchestrationService monitors all agents via AgentHealthMonitor
  → On completion, MergeResolver merges branches back
  → All events projected into thread state via existing ThreadService
```

### Responsibility Split

**Ultra's backend owns:**
- Process spawning and lifecycle (via existing RuntimeSupervisor)
- Worktree creation and teardown
- Hook deployment and agent sandboxing
- Agent health monitoring and escalation
- Merge resolution
- Thread state projection (already built)
- Agent tree tracking per thread

**Agents own:**
- Their assigned task execution
- Leads: task decomposition and spawn requests
- Builders: implementation, tests, commits within their worktree
- Scouts: exploration, information gathering
- Reviewers: validation, quality checks

### What Gets Retired

- `ov watch` global process
- NDJSON coordinator transport (backend doesn't talk to an external coordinator)
- `WatchService` (was for `ov watch` supervision)
- Overstory's mail system, session store, dashboard

### What Gets Kept

- `RuntimeSupervisor` — still supervises long-lived singleton components (but NOT agents — see below)
- `RuntimeRegistry` — still tracks singleton component state (coordinator, watchdog)
- `SupervisedProcessAdapter` — still the process abstraction
- Thread event schema — updated with new source values (see below)
- Frontend-backend IPC contracts — unchanged (thread subscriptions, queries, commands)
- `WatchdogService` — rewritten as AgentHealthMonitor with ZFC health monitoring

### Shared Contract Changes Required

**`runtimeComponentTypeSchema`** must be extended to include `"agent"` alongside existing `"coordinator" | "watchdog" | "ov_watch"`. The `ov_watch` type should be deprecated. This is needed because `SupervisedProcessAdapter.spawn()` requires a `componentType` on `SupervisedProcessSpec`.

**Agents bypass RuntimeSupervisor.** RuntimeSupervisor is designed for singleton long-lived components with `(projectId, componentType)` keyed lookup — multiple agents of the same type under one project would collide. Instead, OrchestrationService calls `SupervisedProcessAdapter.spawn()` directly and tracks agent lifecycle through the new `AgentRegistry`. RuntimeSupervisor continues to manage the remaining singleton processes (if any remain after the ov_watch retirement).

**Thread event source values** change from `ov.coordinator` and `ov.worker` to:
- `ultra.orchestration` — events from the OrchestrationService itself
- `ultra.agent.lead` — events from lead agents
- `ultra.agent.builder` — events from builder agents
- `ultra.agent.scout` — events from scout agents
- `ultra.agent.reviewer` — events from reviewer agents

**Coordinator NDJSON protocol is retired.** The existing coordinator transport (command/response/event envelopes with `protocol_version`, `request_id`, `sequence_number`) is replaced by the simpler agent NDJSON protocol defined in this spec. The OrchestrationService produces thread events directly — no intermediate coordinator envelope translation.

## User Interaction Model

```
Chat (user-facing coordinator / planning conversation)
├── Thread A → Lead agent + up to 8 sub-agents
├── Thread B → Lead agent + up to 8 sub-agents
└── Thread C → Lead agent + up to 8 sub-agents
```

- **Chat** = the user's primary planning conversation. Acts as the coordinator (user + AI planning together).
- **Thread** = an execution unit spawned from a chat. Each thread gets its own lead agent plus up to 8 sub-agents.
- **Realistic concurrency**: 3-6 threads active at once, could go up to ~10. No hard limit enforced.

### Thread Communication — Dual Surface

1. **Thread detail pane** — dedicated chat input for direct conversation with the lead. Primary interaction surface when focused on a thread.
2. **Main chat** — users can ask about or message a thread's coordinator from the planning chat. Messages route to the appropriate lead, responses surface inline.

## Agent Hierarchy

### Agent Types

| Type | Model (Claude) | Model (OpenAI) | Model (Google) | Worktree | Can Spawn | Read-Only | Purpose |
|------|---------------|----------------|----------------|----------|-----------|-----------|---------|
| Lead | opus | o3 | gemini-pro | yes | yes (up to 8) | no | Decomposes specs, coordinates sub-agents, verifies work |
| Builder | sonnet | gpt-4o | gemini-pro | yes | no | no | Implements code, runs tests, commits |
| Scout | haiku | gpt-4o-mini | gemini-flash | yes | no | yes | Explores codebase, gathers information |
| Reviewer | sonnet | gpt-4o | gemini-pro | yes | no | yes | Reviews implementation, validates quality |

Model assignments are derived from the chat's provider. The mapping table lives in config, keyed by provider. Users can override.

### Branch Naming

```
ultra/{thread-id}/{agent-type}-{agent-id}
```

Example: `ultra/thr_abc123/builder-agt_def456`

Leads get: `ultra/{thread-id}/lead`

### Agent State Model

There is one unified state machine for each agent, tracked by the AgentRegistry. The health monitor reads and transitions health-related states within this same model.

```
pending → spawning → booting → running → completing → completed
                           ↘ failed                 ↗
                             stalled → zombie → terminated
                               ↑          ↗
                             (recovery: stalled → running if output resumes)
```

- **pending** — spawn requested, worktree not yet created
- **spawning** — worktree created, hooks deployed, process starting
- **booting** — process launched, waiting for first stdout output
- **running** — process alive, producing output within thresholds
- **completing** — agent reported done, merge pending
- **completed** — branch merged (or no changes), worktree cleaned up
- **failed** — agent errored out, worktree preserved for inspection
- **stalled** — no output for `staleMs` (default: 5 minutes), escalation in progress
- **zombie** — no output for `zombieMs` (default: 15 minutes), likely stuck
- **terminated** — killed by health monitor after escalation exhausted

The OrchestrationService manages `pending → spawning → booting` and `completing → completed/failed`. The health monitor manages `running → stalled → zombie → terminated` transitions. Recovery: a stalled agent that resumes output transitions back to running.

### Thread Execution Flow

1. User approves work in chat → `start_thread`
2. OrchestrationService creates lead worktree with branch `ultra/{thread-id}/lead`
3. Spawns lead agent with generated CLAUDE.md (base definition + task overlay)
4. Lead reads spec, decomposes work, emits `spawn_agent` requests via stdout
5. Backend spawns each sub-agent in its own worktree (branched from the lead's branch)
6. Sub-agents execute, commit to their branches, emit `agent_done` on stdout
7. Backend merges sub-agent branches back into lead's branch via MergeResolver
8. Lead verifies merged work, emits `thread_done`
9. Backend merges lead branch into the project's base branch
10. Worktrees cleaned up, thread marked completed

### Two-Layer Instruction System

Each agent gets a `CLAUDE.md` injected into its worktree:

- **Layer 1 — Base definition**: HOW the agent works. Role description, capabilities, constraints, communication protocol, completion protocol. Reusable across tasks.
- **Layer 2 — Task overlay**: WHAT the agent works on. Task ID, spec content, branch name, file scope, parent agent, quality gates. Generated per-spawn.

Template uses `{{PLACEHOLDER}}` substitution.

### NDJSON Protocol (Agent → Backend)

Agents emit structured events on stdout:

```jsonl
{"type": "status", "summary": "Reading spec and planning decomposition"}
{"type": "spawn_agent", "agent_type": "builder", "task": "Implement worktree manager", "file_scope": ["src/orchestration/worktree-manager.ts"]}
{"type": "spawn_agent", "agent_type": "scout", "task": "Find all git command usage patterns"}
{"type": "agent_message", "content": "Decomposed into 3 builder tasks and 1 scout task"}
{"type": "agent_done", "summary": "All sub-tasks verified and passing", "result": "success"}
```

Non-JSON stdout lines are treated as log output and emitted as `thread_log_chunk` events. Malformed JSON is logged and skipped.

## Worktree Manager

Ported from `vendor/overstory/src/worktree/manager.ts`.

### Operations

**`createWorktree(options)`**
- Creates a new git worktree + branch for an agent
- Input: `{ repoRoot, baseDir, baseBranch, agentType, agentId, threadId }`
- Output: `{ worktreePath, branchName }`
- Creates branch from `baseBranch` (for leads: project's main branch; for sub-agents: lead's branch)
- Worktree location: `{repoRoot}/.ultra/worktrees/{threadId}/{agentType}-{agentId}/`
- Runs: `git worktree add -b {branch} {path} {baseBranch}`

**`removeWorktree(repoRoot, worktreePath, options)`**
- Tears down worktree and optionally deletes the branch
- Checks `isBranchMerged()` before deleting branch (safety)
- `{ force: boolean, deleteBranch: boolean }`
- Runs: `git worktree remove {path}` then `git branch -d {branch}`

**`listWorktrees(repoRoot)`**
- Parses `git worktree list --porcelain`
- Returns array of `{ path, branch, head, isLocked }`
- Used by health monitor to reconcile state

**`rollbackWorktree(repoRoot, worktreePath, branchName)`**
- Best-effort cleanup on failed spawn
- Removes worktree, deletes branch, swallows errors
- Called when agent process fails to start

**`isBranchMerged(repoRoot, branch, targetBranch)`**
- Checks if branch is fully merged into target
- `git branch --merged {target}` and checks presence
- Safety guard before branch deletion

### Adaptation from Overstory

- `Bun.spawn` → Node child process utilities (use project's `execFileNoThrow` where available)
- `Bun.file` → `node:fs`
- Skip `preserveSeedsChanges()` — overstory-specific
- Error handling: throw typed `WorktreeError` with context (path, branch, underlying git error)
- All git commands are identical — only the process spawning API changes

### Storage

```
{repoRoot}/
  .ultra/
    worktrees/
      {threadId}/
        lead/                    ← lead agent worktree
        builder-{agentId}/       ← builder worktree
        scout-{agentId}/         ← scout worktree
```

`.ultra/worktrees/` is added to `.gitignore`.

## Merge Resolver

Ported from `vendor/overstory/src/merge/resolver.ts`. All four tiers.

### When Merges Happen

Two merge points in the thread lifecycle:

1. **Sub-agent → Lead branch**: When a builder/scout finishes, its branch merges into the lead's branch. Happens multiple times per thread.
2. **Lead → Base branch**: When the lead finishes and all sub-work is verified, the lead's branch merges into the project's main branch. Happens once at thread completion.

Merges are serialized per thread — one merge at a time to avoid cascading conflicts.

### Tier 1: Clean Merge

Attempt `git merge --no-edit {branch}` from the target branch.

**Pre-flight checks:**
- Detect dirty working tree in target worktree
- Auto-stash tracked changes if dirty
- Detect untracked files that would be overwritten by merge
- Move conflicting untracked files aside (rename to `.ultra-backup-{filename}`)
- After merge: pop stash if one was created

If merge completes with exit code 0 → done.

### Tier 2: Auto-Resolve

If tier 1 produces conflicts, attempt automatic resolution.

**`resolveConflictsKeepIncoming(filePath)`**
- Parse conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- Keep the incoming (agent's) side, discard the canonical side
- **Critical safety check**: `hasContentfulCanonical(content)` — if the canonical side has real content (not just whitespace/empty), another agent's already-merged work would be silently dropped. Do NOT auto-resolve — escalate to tier 3.

**`resolveConflictsUnion(filePath)`**
- For files with `merge=union` in `.gitattributes` (append-only files like changelogs)
- Keep both sides concatenated
- `checkMergeUnion()` reads `.gitattributes` to decide which strategy applies

After resolving all conflicted files: `git add .` then `git commit --no-edit`.

### Tier 3: AI-Resolve

If tier 2 can't safely resolve (contentful canonical, complex multi-way conflicts):

- Extract the conflicted file content (with markers)
- Send to an AI model for resolution with prompt: "Resolve these merge conflicts. Return only the resolved file content, no explanation."
- **Provider selection**: Use the thread's chat provider. For Claude: `claude --print`. For other providers: equivalent CLI or API call. The merge resolver takes a provider-agnostic `resolveWithAI(prompt, context)` callback configured at initialization based on the thread's provider.
- **`looksLikeProse(output)`** — safety validator that catches when the LLM returns explanation instead of code. Checks for patterns like "Here's the resolved...", paragraph-length lines without code characters.
- If validation passes: write resolved content, `git add`, `git commit`
- If validation fails: escalate to tier 4

### Tier 4: Reimagine

When tiers 1-3 fail — conflicts are too tangled to merge mechanically or with targeted AI resolution:

- Abort the merge (`git merge --abort`)
- Fetch both versions: the canonical (target branch) file and the incoming (agent branch) file
- Send both complete files to the AI model (via same provider-agnostic callback as tier 3) with the original task context: "Here is the current state of the file on the target branch, and here is the agent's version. The agent was tasked with: {task summary}. Reimplement the agent's changes on top of the canonical version."
- Full reimplementation — the AI sees clean files, not merge artifacts
- Apply the reimplemented content, `git add`, `git commit`
- Same `looksLikeProse()` validation as tier 3
- If reimagine fails: escalate to user via thread event with conflicted files and context

### Tier Summary

| Tier | Strategy | When | Cost |
|------|----------|------|------|
| 1 | Clean merge | No conflicts | Free |
| 2 | Auto-resolve | Conflicts, canonical side empty/whitespace | Free |
| 3 | AI-resolve | Conflicts with contentful canonical, localized | 1 API call per file |
| 4 | Reimagine | Tiers 1-3 failed, tangled conflicts | 1 API call per file (larger context) |
| Escalate | User intervention | Tier 4 failed or validation failed | Thread event surfaced to UI |

### Merge Queue

One FIFO queue per thread. When multiple sub-agents complete around the same time, merges are serialized:

```
builder-1 done → enqueue merge → merging
builder-2 done → enqueue merge → waiting
builder-3 done → enqueue merge → waiting
                                  builder-1 merged → start builder-2
```

## Agent Containment

Ported from `vendor/overstory/src/agents/guard-rules.ts` and `hooks-deployer.ts`.

### Mechanism

Claude Code supports `settings.local.json` with hook definitions. The hooks deployer writes orchestration hooks into each agent's worktree at `.claude/settings.local.json` before the agent process starts.

### Settings Merge Strategy

The deployer **merges** orchestration hooks into the existing `settings.local.json`, never replaces it:

- Read existing `settings.local.json` if present
- Orchestration hooks are tagged with a marker (e.g., `# ultra-orchestration-hook` in script)
- On deploy: remove any existing hooks with the Ultra marker, append new orchestration hooks alongside user-defined hooks
- On re-deploy (restart): same — strip stale Ultra hooks, add fresh ones, preserve everything else
- User hooks, permissions, and other settings are never touched

### Guard Rules

**Blocked native tools** (all agents):
- `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` — agents use Ultra's orchestration
- `Agent` — agents request spawns via stdout, don't self-spawn

**Blocked interactive tools** (all agents):
- `AskUserQuestion` — communicate via stdout NDJSON
- `EnterPlanMode`, `ExitPlanMode` — no interactive planning
- `EnterWorktree`, `ExitWorktree` — Ultra manages worktrees

**Write tools** (blocked for scout, reviewer):
- `Write`, `Edit`, `NotebookEdit`

**Dangerous bash patterns** (blocked for scout, reviewer):
- `rm`, `git push`, `git reset --hard`, `sed -i`, `node -e`, `npm install`, `chmod`, `curl | sh`, etc.

**Safe bash prefixes** (always allowed):
- `git status`, `git log`, `git diff`, `git show`, `git branch`

### Hook Types Per Agent

**1. Path boundary guard** (all agents)
- Validates Write/Edit/NotebookEdit targets are within the agent's worktree
- Uses `ULTRA_WORKTREE_PATH` env var set at spawn time
- Shell script checks resolved path starts with worktree path

**2. Danger guard** (all agents)
- Blocks `git push` (agents commit locally, Ultra merges)
- Blocks branch operations not matching the agent's assigned branch
- Blocks destructive git operations

**3. Capability guard** (varies by agent type)

| Agent Type | Write Tools | Bash Mutations | Spawn Requests |
|-----------|-------------|----------------|----------------|
| Lead | allowed | allowed | via stdout NDJSON |
| Builder | allowed | allowed | blocked |
| Scout | blocked | blocked | blocked |
| Reviewer | blocked | blocked | blocked |

**4. ENV_GUARD pattern**
- All hooks check for `ULTRA_AGENT=true` env var before activating
- Hooks only fire for orchestrated agents, not the user's own sessions
- Set by the backend when spawning agent processes

### Guard Script Design

- Shell built-ins only (grep, echo, shell parameter expansion) — no jq or external deps
- Whitelist-first: check safe prefixes before dangerous patterns
- Multi-layered shell escaping for bash command inspection

## Agent Health Monitor

Ported from `vendor/overstory/src/watchdog/daemon.ts` and `health.ts`. Replaces current WatchdogService.

### ZFC Principle (Zero Failure Crash)

Observable state always beats recorded state.

Signal priority:
1. **Is the process alive?** — `process.kill(pid, 0)` (zero-cost, no-signal check)
2. **Is it producing output?** — last stdout timestamp
3. **What does the agent registry say?** — lowest priority

If the process is dead but the registry says "running" → the process is dead. Trust the observation.

### Health Monitoring Within the Unified State Machine

The health monitor operates on the unified agent state model defined in the Agent Hierarchy section. It is responsible for transitioning agents between `running`, `stalled`, `zombie`, and `terminated` states. It does not own a separate state machine — it reads and writes the same `AgentNode.state` field in the AgentRegistry.

Health monitor transitions:
- `running → stalled`: no output for `staleMs` (default: 5 minutes)
- `stalled → zombie`: no output for `zombieMs` (default: 15 minutes)
- `stalled/zombie → terminated`: escalation exhausted
- `stalled → running`: agent resumes output (recovery)

### Progressive Escalation

| Level | Action | When |
|-------|--------|------|
| 0 — Warn | Log warning, emit thread event | First stale detection |
| 1 — Nudge | Send message to agent's stdin: "You appear stalled. Report status." | After 1 warn cycle |
| 2 — Triage | Spawn scout to inspect stalled agent's worktree and report | After 1 nudge cycle with no response |
| 3 — Terminate | Kill process, emit `thread_agent_failed`, preserve worktree | After triage completes or times out |

Each escalation level is logged and surfaced as a thread event.

### Monitoring Cadence

- **Active threads**: check every 30 seconds
- **Idle (no active agents)**: check every 5 minutes
- Per-agent check is lightweight: PID liveness + last activity timestamp

### Special Cases

- **Lead agents waiting for sub-agents**: not stalled. Health monitor knows when a lead has pending spawn requests and exempts it from stale detection while sub-agents are running.
- **Agents in long tool calls**: stdout activity timestamp updates on any output including partial results. Longer threshold before flagging agents running test suites or builds.

## Agent Definitions & Overlay Generator

Ported from `vendor/overstory/agents/*.md` and `src/agents/overlay.ts`.

### Base Definitions

Stored as markdown in `apps/backend/src/orchestration/agent-defs/`.

**Lead** (`lead.md`)
- Role: decompose specs into sub-tasks, dispatch workers, verify results
- Can request spawns (builder, scout, reviewer)
- Coordinates execution plan, doesn't implement directly except trivial glue
- Completion: verify all sub-agent work merged, run quality gates, emit `thread_done`
- Failure modes: over-decomposition, under-verification

**Builder** (`builder.md`)
- Role: implement code, run tests, commit to worktree branch
- Works within assigned file scope
- Completion: all tests pass, changes committed, emit `agent_done`
- Failure modes: scope creep, skipping tests

**Scout** (`scout.md`)
- Role: read-only exploration, information gathering
- Returns findings as structured output, never modifies files
- Cheapest agent (haiku-tier model)
- Completion: emit `agent_done` with findings summary

**Reviewer** (`reviewer.md`)
- Role: read-only validation of implementation
- Checks code quality, test coverage, spec conformance
- Completion: emit `agent_done` with pass/fail and findings

Each definition includes:
- Propulsion principle (act immediately, no confirmation seeking)
- Cost-awareness guidelines
- Named failure modes with recovery steps
- Communication protocol (stdout NDJSON events)
- Constraints

### Overlay Generator

`generateOverlay()` produces a `CLAUDE.md` per agent at spawn time:

```
Layer 1: Base Definition (from agent-defs/{type}.md)
─────────────────────────────────────────────────────
Layer 2: Task Overlay (generated per-spawn)
  - Agent ID, thread ID, branch name, worktree path
  - Task description / spec content
  - File scope
  - Parent agent (for sub-agents)
  - Quality gates (commands to run before declaring done)
  - Provider-specific instructions (Claude vs Codex vs Gemini)
```

Provider adaptation lives only in the overlay. Base definitions are runtime-agnostic.

## OrchestrationService

The central service that wires everything together. Replaces CoordinatorService.

### Dependencies

```
OrchestrationService
  ├── SupervisedProcessAdapter // existing — spawns agent child processes directly
  ├── ThreadService          // existing — thread state projection
  ├── WorktreeManager        // new — git isolation
  ├── MergeResolver          // new — tiered conflict resolution
  ├── AgentContainment       // new — guard rules + hooks deployer
  ├── AgentHealthMonitor     // new — ZFC watchdog
  ├── AgentRegistry          // new — tracks agent tree per thread
  └── OverlayGenerator       // new — produces CLAUDE.md per agent
```

### Core Methods

**`startThread(threadId, spec, projectContext)`**
1. Resolve base branch from project
2. Create lead worktree via WorktreeManager
3. Generate lead CLAUDE.md via OverlayGenerator
4. Deploy hooks via AgentContainment
5. Spawn lead process via SupervisedProcessAdapter with `--dangerously-skip-permissions`
6. Attach stdout parser for NDJSON events
7. Register lead in AgentRegistry
8. Start health monitoring
9. Emit `thread_agent_started` via ThreadService

**`handleAgentEvent(threadId, agentId, event)`**
- Routes parsed NDJSON events from agent stdout
- `status` → emit `thread_agent_progressed`
- `spawn_agent` → call `spawnSubAgent()`
- `agent_message` → emit `thread_message_emitted`
- `agent_done` → call `completeAgent()`

**`spawnSubAgent(threadId, parentAgentId, request)`**
1. Check active agent count < 8 (agents in `pending`, `spawning`, `booting`, or `running` state — completed, failed, and terminated agents do not count toward the limit; if the limit is reached, the spawn request is rejected and the lead is notified via an error event on its stdin)
2. Create sub-agent worktree branched from parent's branch
3. Generate CLAUDE.md with task from spawn request
4. Deploy hooks (capability-based on agent type)
5. Spawn process, attach stdout parser
6. Register in AgentRegistry with parent reference
7. Emit `thread_agent_started`

**`completeAgent(threadId, agentId)`**
1. Mark agent as completing in AgentRegistry
2. If sub-agent: enqueue merge of agent branch → parent branch via MergeResolver
3. On merge success: clean up worktree, mark completed, emit `thread_agent_finished`
4. On merge failure: emit thread event with conflict details, mark failed
5. If lead and all sub-agents done: enqueue final merge of lead branch → base branch
6. On final merge success: clean up, emit `thread_execution_state_changed` to completed

**`terminateAgent(threadId, agentId, reason)`**
- Kill process, preserve worktree for inspection
- Emit `thread_agent_failed`
- If lead terminated: fail the entire thread

### Agent Registry

In-memory tracking backed by thread events for durability:

```typescript
type AgentNode = {
  agentId: string
  threadId: string
  agentType: "lead" | "builder" | "scout" | "reviewer"
  parentAgentId: string | null
  pid: number
  worktreePath: string
  branchName: string
  state: AgentState
  lastActivity: string
  escalationLevel: number
}
```

On backend restart, the registry rebuilds from thread state.

### Stdout NDJSON Parser

Attached to each agent's supervised process handle:

- Read lines from stdout
- Attempt JSON parse on each line
- Valid NDJSON with recognized `type` field → route to `handleAgentEvent()`
- Non-JSON lines → treat as log output, emit as `thread_log_chunk`
- Malformed JSON → log warning, skip

Agents can freely mix structured events with regular stdout output.

### What Happens to Existing Code

- `CoordinatorService` → **replaced** by OrchestrationService
- `WatchdogService` → **replaced** by AgentHealthMonitor
- `WatchService` (ov watch) → **retired**
- `watchdog-helper.ts` → **retired**, logic moves to AgentHealthMonitor
- `SupervisedProcessAdapter` → **kept**, used directly by OrchestrationService to spawn agent processes
- `RuntimeSupervisor` → **kept** for any remaining singleton components, but NOT used for agents
- `RuntimeRegistry` → **kept** for singleton component tracking, but NOT used for agents

## Backend Restart & Crash Recovery

When the Ultra backend restarts (crash, update, or manual restart):

1. **Rebuild AgentRegistry from thread state** — scan all threads with `execution_state = "running"`. For each, reconstruct the agent tree from persisted `thread_agent_started`/`thread_agent_finished`/`thread_agent_failed` events.

2. **Check PID liveness for each agent** — `process.kill(pid, 0)`. Agents that survived the backend restart (still running as child processes) can be re-attached by re-opening their stdout for NDJSON parsing.

3. **Mark dead agents** — agents whose PIDs are gone are marked `failed` with reason `"backend_restart_orphaned"`. Their worktrees are preserved for inspection.

4. **Handle in-progress merges** — if a merge was in progress when the backend crashed, the worktree may be in a dirty merge state. On recovery, detect this (`git status` in the target worktree) and run `git merge --abort` to restore a clean state. The merge can be re-attempted when the sub-agent's branch is re-enqueued.

5. **Emit recovery events** — for each affected thread, emit `thread_execution_state_changed` or `thread_agent_failed` as appropriate so the UI reflects the current state.

6. **Do not auto-restart agents** — failed agents from a backend crash are surfaced to the user. The user decides whether to retry the thread.

## Secret Redaction

Ported from `vendor/overstory/src/logging/sanitizer.ts` (57 lines).

Regex patterns for redacting secrets from agent output before logging or surfacing to UI:
- `sk-ant-*` (Anthropic API keys)
- `github_pat_*`, `ghp_*` (GitHub tokens)
- `Bearer *` (auth headers)
- `ANTHROPIC_API_KEY=*`

Simple `sanitize(string)` and `sanitizeObject(obj)` functions. Applied to all agent stdout before thread event projection.

## Spec & Documentation Updates

### Specs to Update

**`docs/coordinator-runtime.md`** → retire and replace
- The entire external coordinator model (transport contract, envelope shapes, command surface, ordering rules, `ov watch` section) is replaced by this spec. Rather than surgically editing, retire coordinator-runtime.md with a deprecation header pointing to this spec.
- Sections worth preserving as standalone references: the v1 event payload definitions (heartbeat, thread_agent_started, etc.) and the persistence rules. These should be absorbed into `thread-event-schema.md` and this spec respectively.

**`docs/thread-event-schema.md`** → update source values and add new event types
- Replace `ov.coordinator` and `ov.worker` source values with `ultra.orchestration`, `ultra.agent.lead`, `ultra.agent.builder`, `ultra.agent.scout`, `ultra.agent.reviewer`
- Deprecate `ov_coordinator_id` and `ov_thread_key` identity fields
- Add event types for merge resolution outcomes and agent escalation

**`docs/product-spec.md`** → minor
- Replace "Overstory/Seeds mechanics" → "internal orchestration mechanics"

**`docs/thread-contract.md`** → minor
- Replace "Overstory internals" → "Ultra's orchestration layer"
- Replace "Overstory workers" → "sub-agents"
- Deprecate `ov_project_id`, `ov_coordinator_id`, `ov_thread_key` identity fields

**`docs/implementation-plan/04-runtime-supervision*.md`** → major rewrite
- New milestone scope: build orchestration layer
- New architecture around OrchestrationService
- New sprint plan with component tickets

### Tickets

**Close/annotate:**
- `ULR-39` (already closed) — add note: "`ov watch` retired, replaced by AgentHealthMonitor"

**Rewrite:**
- `ULR-40` — becomes "Implement OrchestrationService with internal agent lifecycle and thread routing"

**New tickets:**

| Ticket | Title | Blocked By |
|--------|-------|------------|
| A1 | Implement WorktreeManager | — |
| A2 | Implement guard rules and AgentContainment hooks deployer | — |
| A3 | Implement OverlayGenerator and agent base definitions | — |
| A4 | Implement AgentRegistry and NDJSON stdout parser | — |
| A5 | Implement MergeResolver (tiers 1-4) | A1 |
| A6 | Implement AgentHealthMonitor (ZFC watchdog) | A4 |
| A7 | Implement OrchestrationService (glue) | A1, A2, A3, A4, A5, A6 |
| A8 | Wire OrchestrationService into thread execution flow | A7, ULR-40 |
| A9 | Implement provider model mapping (Claude/OpenAI/Google) | A3 |
| A10 | Add secret redaction utility | — |
| A11 | Update coordinator-runtime.md, product-spec.md, thread-contract.md | — |
| A12 | Rewrite M4 runtime supervision architecture and sprint plan | — |

A1-A4 can be built in parallel. A5-A6 depend on foundation pieces. A7 is the integration point. A8 wires into existing thread flow.
