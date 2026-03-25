# Ultra v2: TUI Orchestrator

**Date:** 2026-03-25
**Status:** Draft
**Replaces:** Ultra v1 (Electron desktop app)

## Problem

Ultra v1 is a 40k+ line Electron app that spent most of its complexity on chat UI, IPC, and tool wrapping — none of which is the product's differentiator. The real value proposition is **AI orchestration**: a coordinator that spawns, manages, and communicates with multiple Claude Code agents working across git worktrees.

## Product Definition

Ultra v2 is a CLI tool that wraps Claude Code (or Codex) with orchestration capabilities. From the user's perspective, they're in Claude Code — but with extra tools that let the AI coordinate work across multiple sessions.

**What it is:**
- A daemon + CLI that turns any Claude Code session into an orchestration-aware participant
- Two MCP servers (coordinator + agent) that provide bidirectional real-time communication
- A session registry where any Claude instance can join, be spawned, or be attached to

**What it is NOT:**
- Not a chat app (Claude Code is the UI)
- Not a TUI framework (no custom rendering, no pane management)
- Not a tool wrapper (Claude Code handles all file editing, bash, git, etc.)

## Core User Flows

### Flow 1: Coordinated Session

```bash
ultra
```

Launches Claude Code with the coordinator MCP server. Claude is given a system prompt establishing it as a coordinator. You talk to Claude normally, but it has extra tools to spawn and manage agents.

You say: "Refactor the auth module and add rate limiting."

Claude decides these are independent, calls `spawn_agent` twice. Two Claude Code processes start on separate worktrees. You keep chatting with the coordinator. It reports progress, routes messages, and tells you when agents are done.

### Flow 2: Manual Join

```bash
# You're already in a terminal, working on something
ultra join --name my-experiment
```

Launches Claude Code with the agent MCP server, registered with the running daemon. The coordinator now sees this session and can message it. You work normally — but you're part of the network.

### Flow 3: Attach to Agent

```bash
ultra attach auth-work
```

Connects your terminal to an existing agent's PTY session. You can interact with it directly — answer questions, approve tool use, give it new instructions. Detach when done; the agent keeps running.

### Flow 4: Headless Spawn

```bash
ultra spawn "fix the login bug" --branch fix/login
```

Creates a worktree, launches a Claude Code agent, and lets it work. No coordinator session needed. You can check on it later with `ultra list` or open a coordinator session that picks it up.

### Flow 5: Status Check

```bash
ultra list
```

Shows all registered sessions: name, worktree, status (active/idle/blocked/done), last activity.

### Flow 6: Direct Message

```bash
ultra send auth-work "use passport, not custom jwt"
```

Sends a message to a specific agent without entering the coordinator. The message is delivered via the agent's MCP server.

## Architecture

```
┌────────────────┐     ┌──────────────────────┐     ┌────────────────┐
│ claude (coord)  │────▶│                      │◀────│ claude (agent1) │
│ + coordinator   │◀────│    ultra daemon       │────▶│ + agent MCP     │
│   MCP server    │     │                      │     └────────────────┘
└────────────────┘     │  - session registry   │     ┌────────────────┐
                       │  - message broker     │◀────│ claude (agent2) │
┌────────────────┐     │  - process manager    │────▶│ + agent MCP     │
│ claude (manual) │────▶│  - worktree manager   │     └────────────────┘
│ + agent MCP     │◀────│                      │
└────────────────┘     └──────────────────────┘
```

### Components

#### 1. Ultra Daemon

A long-running background process that all sessions connect to. Starts automatically on first `ultra` command, persists until explicitly stopped or all sessions disconnect.

**Responsibilities:**
- **Session registry:** Track all connected sessions (name, type, worktree, PID, status, last activity)
- **Message broker:** Route messages between sessions in real-time
- **Process manager:** For sessions it spawned — track PIDs, detect exit, keep alive if configured
- **Worktree manager:** Create worktrees for new agents, clean up after completed work

**Communication protocol:** Local Unix domain socket. MCP servers connect to it as clients. Simple JSON-over-newline protocol:

```typescript
// Messages between MCP servers and daemon
type DaemonMessage =
  | { type: "register"; sessionId: string; name: string; role: "coordinator" | "agent"; worktree: string }
  | { type: "deregister"; sessionId: string }
  | { type: "send_message"; from: string; to: string; content: string }
  | { type: "receive_message"; from: string; content: string }
  | { type: "status_update"; sessionId: string; status: SessionStatus }
  | { type: "list_sessions"; }
  | { type: "sessions_list"; sessions: SessionInfo[] }
  | { type: "spawn_agent"; name: string; prompt: string; branch?: string; worktree?: string }
  | { type: "agent_spawned"; sessionId: string; name: string; worktree: string }
```

#### 2. Coordinator MCP Server

An MCP server attached to the coordinator's Claude Code session. Provides tools for orchestration.

**Tools:**

| Tool | Description |
|---|---|
| `spawn_agent` | Create a new agent session on a worktree. Params: `name`, `prompt`, `branch` (optional), `context` (optional — files or text to pass). Returns agent ID. |
| `list_agents` | List all registered sessions with their status, worktree, and last activity. |
| `message_agent` | Send a message to a specific agent. Params: `agent_name`, `message`. |
| `check_messages` | Check for any incoming messages from agents. Returns array of messages. |
| `get_agent_diff` | Get the git diff of an agent's worktree (what has it changed so far). Params: `agent_name`. |
| `dismiss_agent` | Stop an agent session and optionally clean up its worktree. Params: `agent_name`, `cleanup` (boolean). |

#### 3. Agent MCP Server

An MCP server attached to each agent's Claude Code session. Provides tools for communicating back to the coordinator.

**Tools:**

| Tool | Description |
|---|---|
| `report_to_coordinator` | Send a message to the coordinator. Params: `message`. Use for progress updates, questions, or completion reports. |
| `request_input` | Signal that this agent is blocked and needs human or coordinator input. Params: `question`. Sets status to "blocked". |
| `mark_done` | Signal that this agent has completed its task. Params: `summary`. Sets status to "done". |
| `check_messages` | Check for incoming messages from the coordinator. Returns array of messages. |

#### 4. CLI Entry Points

```
ultra                              # Launch coordinator session
ultra spawn <prompt> [--branch X]  # Spawn a headless agent
ultra join [--name X]              # Join current terminal to the network
ultra attach <agent-name>          # Attach to an agent's PTY
ultra list                         # List all sessions
ultra send <agent-name> <message>  # Send a message to an agent
ultra stop [agent-name]            # Stop an agent (or all)
ultra daemon stop                  # Stop the daemon
```

### Session Lifecycle

```
                 ultra spawn / coordinator spawn_agent
                              │
                              ▼
                    ┌──────────────────┐
                    │     spawning     │
                    └────────┬─────────┘
                             │ claude process started
                             ▼
                    ┌──────────────────┐
              ┌────▶│     active       │◀────┐
              │     └────────┬─────────┘     │
              │              │               │
              │    request_input        message from
              │              │          coordinator
              │              ▼               │
              │     ┌──────────────────┐     │
              │     │     blocked      │─────┘
              │     └──────────────────┘
              │
         message from
         coordinator
              │
              │     mark_done / process exit
              │              │
              │              ▼
              │     ┌──────────────────┐
              └─────│      done        │
                    └──────────────────┘
                             │
                    dismiss_agent / cleanup
                             │
                             ▼
                    ┌──────────────────┐
                    │    cleaned up    │
                    └──────────────────┘
```

### Worktree Management

When the coordinator (or CLI) spawns an agent:

1. If `--branch` is specified, create worktree from that branch (or create the branch if it doesn't exist)
2. If no branch specified, create a worktree from current HEAD with an auto-generated branch name (`ultra/<agent-name>`)
3. Launch `claude` with `--cwd <worktree-path>` and the agent MCP server
4. On cleanup: delete worktree, optionally delete branch

Worktrees live in a standard location: `../<repo-name>-ultra-worktrees/<agent-name>/`

### Context Passing

When the coordinator spawns an agent, it can pass context:

- **Prompt:** The task description, including any planning context from the coordinator conversation
- **Files:** Specific file paths to highlight (passed as part of the prompt, e.g., "focus on these files: ...")
- **System prompt additions:** The agent gets a base system prompt ("You are an agent managed by Ultra...") plus any context the coordinator provides

This is all done via Claude Code's existing `--prompt` and `--system-prompt` flags. No custom injection needed.

### Real-Time Messaging

Messages are delivered in real-time via the daemon's socket connection. When an agent calls `report_to_coordinator`, the daemon pushes the message to the coordinator's MCP server. The coordinator sees it next time it calls `check_messages` (or the MCP server can use notifications if the protocol supports it).

For practical purposes, Claude Code sessions poll `check_messages` when contextually appropriate — e.g., the coordinator checks after spawning agents, periodically during long conversations, or when the user asks "how are my agents doing?"

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js 22+
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Process management:** `node-pty` for PTY-backed agent sessions
- **CLI framework:** Lightweight — `commander` or just raw `process.argv` parsing
- **IPC:** Unix domain socket (`net` module) with JSON-over-newline protocol
- **Git operations:** `execFile` (not shell-based `exec`) for safe git worktree commands

## File Structure

```
ultra/
├── src/
│   ├── cli.ts                  # CLI entry point, command parsing
│   ├── daemon.ts               # Ultra daemon — session registry, message broker, process manager
│   ├── coordinator-mcp.ts      # Coordinator MCP server
│   ├── agent-mcp.ts            # Agent MCP server
│   ├── worktree-manager.ts     # Git worktree create/list/cleanup
│   ├── process-manager.ts      # Spawn/track/attach claude PTY processes
│   ├── protocol.ts             # Shared message types for daemon communication
│   └── config.ts               # Paths, defaults, constants
├── package.json
├── tsconfig.json
└── README.md
```

**Estimated size:** ~1500-2500 lines total for MVP.

## Scope Boundaries

**MVP includes:**
- Daemon with session registry and message routing
- Coordinator MCP server with spawn/list/message/dismiss tools
- Agent MCP server with report/request-input/mark-done/check-messages tools
- CLI commands: `ultra`, `ultra spawn`, `ultra join`, `ultra attach`, `ultra list`, `ultra send`, `ultra stop`
- Git worktree management (create, cleanup)
- PTY-based process management for spawned agents

**MVP does NOT include:**
- Persistence across daemon restarts (sessions are ephemeral)
- Agent-to-agent direct communication (always through coordinator)
- Web UI or TUI dashboard
- Authentication or multi-user support
- Automatic agent retry/restart on failure
- Cost tracking or token usage monitoring

**Future possibilities (not in scope):**
- Session persistence and resume after daemon restart
- TUI dashboard mode (`ultra dashboard`) for visual monitoring
- Agent templates (predefined roles/system prompts)
- Worktree merge automation
- Integration with CI/CD for automated agent spawning

## Success Criteria

1. User can launch `ultra` and be in a Claude Code session with orchestration tools
2. Coordinator can spawn agents that run on separate worktrees
3. Real-time bidirectional messaging works between coordinator and agents
4. User can manually join sessions and have the coordinator see them
5. User can attach to agent PTYs for direct interaction
6. The entire codebase is under 3000 lines
