# Ultra v2: CLI Orchestrator

**Date:** 2026-03-25
**Status:** Draft (v2 — revised after brainstorming)
**Replaces:** Ultra v1 (Electron desktop app)

## Problem

Ultra v1 is a 40k+ line Electron app that spent most of its complexity on chat UI, IPC, and tool wrapping — none of which is the product's differentiator. The real value proposition is **AI orchestration**: a coordinator that spawns, manages, and communicates with multiple Claude Code agents working across git worktrees.

## Product Definition

Ultra v2 is a CLI tool that wraps Claude Code with orchestration capabilities. From the user's perspective, they're in Claude Code — but with extra tools that let the AI coordinate work across multiple sessions. The user runs one command: `ultra`. Everything else happens through conversation.

**What it is:**
- A daemon + CLI that turns Claude Code into a multi-agent coordinator
- Two MCP servers (coordinator + agent) providing bidirectional real-time communication
- A session registry that auto-discovers Claude Code sessions via hooks
- Claude Code only (no Codex support)

**What it is NOT:**
- Not a chat app (Claude Code is the UI)
- Not a TUI framework (no custom rendering, no pane management)
- Not a tool wrapper (Claude Code handles all file editing, bash, git, etc.)

**Design principles:**
- Minimal user intervention — the user talks to Claude, Claude does everything
- MCP servers are invisible — they start, stop, and connect automatically
- Agents are always sandboxed in git worktrees with `--dangerously-skip-permissions`
- The daemon is a background process the user never thinks about

## Core User Flows

### Flow 1: Coordinated Session (primary flow)

```bash
ultra
```

That's it. This:
1. Starts the daemon (if not already running)
2. Starts the coordinator MCP server (managed by the daemon)
3. Launches `claude` with the coordinator MCP attached and a coordinator system prompt

You're now in Claude Code. You talk normally. Claude has extra tools to spawn and manage agents. You say: "Refactor the auth module and add rate limiting." Claude decides these are independent, calls `spawn_agent` twice. Two Claude Code processes start on separate worktrees with `--dangerously-skip-permissions`. Claude reports progress and tells you when they're done.

### Flow 2: Attach to Agent

```bash
ultra attach auth-agent
```

Looks up the agent's conversation ID and worktree path from the daemon registry. Runs `claude --resume <conversation-id> --cwd <worktree-path>`. You're now directly in that agent's Claude Code session. The daemon resolved everything — you just needed the agent name.

### Flow 3: Status Check

```bash
ultra list
```

Shows all registered sessions with connect commands:

```
NAME             STATUS    WORKTREE                                         BRANCH              LAST ACTIVITY
auth-agent       active    /Users/tony/Projects/myapp-ultra-wt/auth-agent   ultra/auth-agent    3s ago
pagination-fix   done      /Users/tony/Projects/myapp-ultra-wt/pag-fix      ultra/pag-fix       2m ago
my-experiment    active    /Users/tony/Projects/myapp                       main                10s ago (auto-discovered)
```

### Flow 4: Auto-Discovery

A Claude Code hook is installed at `~/.claude/hooks/` (or project-level). When any Claude Code session starts on the machine, the hook pings the daemon to register it. The coordinator sees it automatically — no `ultra join` needed.

This means if you open a second terminal and run `claude` in any worktree, the coordinator already knows about it.

## Architecture

```
┌─────────────────┐     ┌───────────────────────┐     ┌─────────────────┐
│ claude (coord)   │────▶│                       │◀────│ claude (agent1)  │
│ + coordinator    │◀────│     ultra daemon       │────▶│ + agent MCP      │
│   MCP server     │     │                       │     └─────────────────┘
└─────────────────┘     │  - session registry    │     ┌─────────────────┐
                        │  - message broker      │◀────│ claude (agent2)  │
┌─────────────────┐     │  - process manager     │────▶│ + agent MCP      │
│ claude (auto-    │────▶│  - worktree manager    │     └─────────────────┘
│  discovered)     │     │                       │
└─────────────────┘     └───────────────────────┘
```

### Components

#### 1. Ultra Daemon

A long-running background process. Starts automatically on `ultra`, the user never manages it directly.

**Startup sequence:**
1. CLI tries to connect to `~/.ultra/daemon.sock`
2. If connection refused or socket missing → spawn daemon as detached background process
3. Daemon writes PID to `~/.ultra/daemon.pid` and creates `~/.ultra/daemon.sock`
4. CLI retries connection (up to 3 attempts, 500ms apart)
5. On stale socket (file exists but connection refused) → unlink socket, respawn daemon

**Responsibilities:**
- **Session registry:** Track all sessions (name, conversation ID, worktree, PID, status, last activity)
- **Message broker:** Route messages between sessions in real-time via socket
- **Process manager:** Spawn agent `claude` processes, track PIDs, detect exit
- **Worktree manager:** Create/cleanup git worktrees for agents
- **MCP server host:** Run coordinator and agent MCP servers in-process

**State persistence:** JSON file at `~/.ultra/state.json`, written on every mutation. On restart, daemon reads this file, checks which PIDs are still alive, and recovers. No SQLite.

```
~/.ultra/
  daemon.sock          # Unix domain socket
  daemon.pid           # PID file for stale detection
  state.json           # Session registry
  logs/
    daemon.log         # Daemon output
```

**Communication protocol:** JSON-over-newline on Unix domain socket. All request messages include a `requestId` for correlation. All responses include the matching `requestId`. Errors include a `code` and `message`.

```typescript
// Base message types
type Request = { requestId: string } & (
  | { type: "register"; name: string; role: "coordinator" | "agent"; worktree: string; conversationId?: string }
  | { type: "deregister"; sessionId: string }
  | { type: "send_message"; to: string; content: string }
  | { type: "list_sessions" }
  | { type: "spawn_agent"; name: string; prompt: string; branch?: string; context?: string }
  | { type: "dismiss_agent"; name: string; cleanup: boolean }
  | { type: "get_agent_diff"; name: string }
)

type Response = { requestId: string } & (
  | { type: "ok"; data?: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "sessions_list"; sessions: SessionInfo[] }
  | { type: "agent_spawned"; name: string; conversationId: string; worktree: string; branch: string }
  | { type: "agent_diff"; name: string; diff: string }
)

// Push messages (no requestId — daemon pushes these to connected clients)
type PushMessage =
  | { type: "incoming_message"; from: string; content: string; timestamp: string }
  | { type: "agent_status_changed"; name: string; status: SessionStatus; summary?: string }
  | { type: "agent_exited"; name: string; exitCode: number }

type SessionStatus = "spawning" | "active" | "blocked" | "done" | "crashed"

type SessionInfo = {
  name: string
  role: "coordinator" | "agent"
  conversationId: string
  worktree: string
  branch: string
  pid: number
  status: SessionStatus
  lastActivity: string // ISO timestamp
  autoDiscovered: boolean
}
```

#### 2. Coordinator MCP Server

Runs inside the daemon process. Connected to the coordinator's Claude Code session via stdio transport (the daemon generates an MCP config file that Claude Code reads on launch).

**Tools:**

| Tool | Description |
|---|---|
| `spawn_agent` | Create a new agent on a worktree. Params: `name` (string, validated `[a-z0-9-]+`), `prompt` (string — task + context), `branch` (optional string). Creates worktree, launches `claude --dangerously-skip-permissions --cwd <worktree>` with agent MCP. Returns: agent name, worktree path, branch, conversation ID, and a connect command for the user. |
| `list_agents` | List all registered sessions with status, worktree, branch, last activity, and connect commands. |
| `message_agent` | Send a message to an agent. Params: `agent_name`, `message`. Delivered in real-time via daemon push. |
| `check_messages` | Check for incoming messages from agents. Returns array of `{ from, content, timestamp }`. Messages are accumulated by the daemon and drained on call. |
| `get_agent_diff` | Get the git diff of an agent's worktree. Params: `agent_name`. Returns the diff string. |
| `dismiss_agent` | Stop an agent and optionally clean up. Params: `agent_name`, `cleanup` (boolean — if true, removes worktree and branch). |

**Message delivery model:** The daemon accumulates messages for each session. When the coordinator calls any MCP tool, pending messages are included as a preamble in the response (e.g., "Note: 2 new messages from agents since your last tool call"). This ensures messages surface naturally without relying on Claude to poll `check_messages` specifically. `check_messages` still exists for explicit polling.

#### 3. Agent MCP Server

One instance per agent, run inside the daemon process. Connected to the agent's Claude Code session via stdio transport.

**Tools:**

| Tool | Description |
|---|---|
| `report_to_coordinator` | Send a message to the coordinator. Params: `message`. Use for progress updates, completion reports, or questions. |
| `request_input` | Signal blocked status, needing human or coordinator input. Params: `question`. Sets agent status to "blocked". |
| `mark_done` | Signal task completion. Params: `summary`. Sets agent status to "done". |
| `check_messages` | Check for incoming messages from the coordinator. Returns array of messages. Same accumulate-and-drain model as coordinator. |

**Agent system prompt template:**
```
You are an autonomous agent managed by Ultra, working in a sandboxed git worktree.

Your task: {prompt}

You have access to tools to communicate with the coordinator:
- report_to_coordinator: Send progress updates or ask questions
- request_input: Signal that you're blocked and need input
- mark_done: Signal that your task is complete

Work autonomously. Report meaningful progress. When done, call mark_done with a summary.
Check for messages periodically using check_messages — the coordinator may send guidance.
```

#### 4. CLI

Three user-facing commands. That's it.

```
ultra                    # Launch coordinator session
ultra list               # Show all sessions with connect commands
ultra attach <name>      # Resume an agent's claude session in this terminal
```

**`ultra` (coordinator):**
1. Ensure daemon is running (start if needed)
2. Daemon starts coordinator MCP server
3. Generate temp MCP config file pointing to coordinator MCP
4. Exec `claude --mcp-config <config> --system-prompt <coordinator-prompt>`

**`ultra list`:**
1. Connect to daemon socket
2. Send `list_sessions` request
3. Print formatted table and exit

**`ultra attach <name>`:**
1. Connect to daemon socket
2. Look up agent by name → get `conversationId` and `worktree`
3. Exec `claude --resume <conversationId> --cwd <worktree>`

### Session Lifecycle

```
                    coordinator calls spawn_agent
                              │
                              ▼
                    ┌──────────────────┐
                    │     spawning     │
                    └────────┬─────────┘
                             │ claude process started, MCP connected
                             ▼
                    ┌──────────────────┐
              ┌────▶│     active       │◀────┐
              │     └────────┬─────────┘     │
              │              │               │
              │    request_input()      coordinator message
              │              │          or user input
              │              ▼               │
              │     ┌──────────────────┐     │
              │     │     blocked      │─────┘
              │     └──────────────────┘
              │
        coordinator message
        or user resumes
              │
              │     mark_done() / process exits cleanly
              │              │
              │              ▼
              │     ┌──────────────────┐
              └─────│      done        │
                    └──────────────────┘
                             │
                    dismiss_agent(cleanup: true)
                             │
                             ▼
                    ┌──────────────────┐
                    │    cleaned up    │  (worktree + branch removed)
                    └──────────────────┘

        process crashes unexpectedly
                    │
                    ▼
           ┌──────────────────┐
           │     crashed      │  (daemon detects via exit code)
           └──────────────────┘
```

### Worktree Management

When the coordinator calls `spawn_agent`:

1. Validate agent name matches `[a-z0-9-]+`, is unique among active sessions
2. Determine branch: use provided `branch` param, or auto-generate `ultra/<agent-name>`
3. Create worktree: `git worktree add <path> -b <branch>` (or `git worktree add <path> <branch>` if branch exists)
4. Worktree path: `../<repo-name>-ultra-worktrees/<agent-name>/`
5. Launch `claude --dangerously-skip-permissions --cwd <worktree-path> --system-prompt <agent-prompt> --mcp-config <agent-mcp-config>`
6. Track PID, conversation ID, worktree path in daemon state

On cleanup (`dismiss_agent` with `cleanup: true`):
1. Kill the claude process if still running
2. Remove worktree: `git worktree remove <path>`
3. Optionally delete branch: `git branch -D <branch>`
4. Remove session from registry

### Auto-Discovery via Claude Code Hooks

Ultra installs a hook that fires when Claude Code sessions start:

**Hook location:** `~/.claude/hooks/session-start.sh` (or project-level equivalent)

**Hook behavior:**
1. Check if ultra daemon is running (try `~/.ultra/daemon.sock`)
2. If running, send a register message with the session's working directory and PID
3. If not running, silently exit (ultra is not active, no-op)

This allows the coordinator to see manually-started Claude Code sessions without those sessions needing to know about Ultra. The hook is lightweight — a single socket write or silent exit.

Auto-discovered sessions appear in `list_agents` with an `autoDiscovered: true` flag. The coordinator can message them, but they won't have the agent MCP tools (no `report_to_coordinator`, etc.) unless they were spawned by Ultra.

### Context Passing

When the coordinator spawns an agent, context is passed via the prompt:

- **Task description:** What the agent should do
- **Relevant context:** File contents, design decisions, constraints — all inlined in the prompt
- **System prompt:** Base agent template (see above) with the task injected

This uses Claude Code's `--system-prompt` and `--prompt` flags. The coordinator is responsible for deciding what context to include — it's part of the coordinator's intelligence, not a feature we build.

### Signal Handling and Shutdown

**Daemon receives SIGTERM/SIGINT:**
1. Write final state to `state.json`
2. Send shutdown notification to all connected MCP servers
3. Do NOT kill agent processes (they can continue running independently)
4. Remove `daemon.sock` and `daemon.pid`
5. Exit

**Agent process crashes (unexpected exit):**
1. Daemon detects via PID monitoring
2. Set agent status to "crashed" with exit code
3. Push `agent_exited` notification to coordinator
4. Worktree is preserved (not auto-cleaned) so work isn't lost

**User exits coordinator (`ultra` session):**
1. Daemon detects coordinator disconnect
2. Agents keep running — they are independent
3. Daemon stays alive — user can `ultra list` or `ultra attach` later
4. If no sessions remain and no coordinator connected for 5 minutes, daemon self-terminates

**User Ctrl+C in coordinator:**
- Claude Code handles this normally (its own interrupt behavior)
- If the user fully exits, same as above — agents persist

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js 22+
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **CLI parsing:** Lightweight — `commander` or raw `process.argv`
- **IPC:** Unix domain socket (`net` module), JSON-over-newline
- **Git operations:** `execFile` for safe, injection-free git commands
- **Process management:** `child_process.spawn` for agent claude processes (no `node-pty` needed — we don't multiplex PTYs, we just spawn and track)

## Project Location

Lives in the existing Ultra monorepo at `apps/cli/`. Standalone — no shared packages, no imports from other workspaces. Copies what it needs.

```
apps/cli/
├── src/
│   ├── cli.ts                  # Entry point, command parsing (~100 lines)
│   ├── daemon.ts               # Daemon: registry, broker, process manager (~500 lines)
│   ├── coordinator-mcp.ts      # Coordinator MCP server (~200 lines)
│   ├── agent-mcp.ts            # Agent MCP server (~150 lines)
│   ├── worktree-manager.ts     # Git worktree create/list/cleanup (~150 lines)
│   ├── process-manager.ts      # Spawn/track claude processes (~200 lines)
│   ├── protocol.ts             # Shared message types (~80 lines)
│   ├── state.ts                # JSON state persistence (~80 lines)
│   └── config.ts               # Paths, defaults, constants (~40 lines)
├── package.json
├── tsconfig.json
└── bin/
    └── ultra                   # Shebang entry point → src/cli.ts
```

**Estimated total:** ~1500 lines for MVP.

## Scope Boundaries

**MVP includes:**
- Daemon with session registry, message routing, and JSON state persistence
- Coordinator MCP server with spawn/list/message/diff/dismiss tools
- Agent MCP server with report/request-input/mark-done/check-messages tools
- Message preamble on all tool calls (no silent message drops)
- CLI commands: `ultra`, `ultra list`, `ultra attach`
- Git worktree management (create, cleanup)
- Process management for spawned agents
- Auto-discovery hook for manually-started Claude Code sessions
- Graceful shutdown and crash detection
- Request/response correlation with request IDs
- Agent name validation and uniqueness

**MVP does NOT include:**
- Codex support (Claude Code only)
- Agent-to-agent direct communication (always through coordinator)
- Session persistence across daemon restarts beyond PID checking
- Web UI or TUI dashboard
- Authentication or multi-user support
- Automatic agent retry/restart on failure
- Cost tracking or token usage monitoring
- Agent templates or predefined roles

**Future possibilities (not in scope):**
- TUI dashboard mode (`ultra dashboard`)
- Codex support via runtime adapters
- Agent templates (predefined roles/system prompts)
- Worktree merge automation from coordinator
- Broadcast messaging to all agents
- Session resume after daemon restart
- `get_agent_diff` as an MCP resource instead of tool

## Success Criteria

1. User runs `ultra` and is in a Claude Code session with orchestration tools
2. Coordinator can spawn agents that work in separate worktrees with `--dangerously-skip-permissions`
3. Real-time bidirectional messaging works between coordinator and agents
4. `ultra attach <name>` connects to any agent session with zero config
5. Auto-discovery hook registers manually-started Claude Code sessions
6. The entire codebase is under 2000 lines
