import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { ChatId } from "@ultra/shared"

import type { ChatMessageSnapshot, ChatRuntimeConfig } from "../chat-service.js"

export type ChatRuntimeCheckpointCandidate = {
  actionType: string
  affectedPaths: string[]
  activeTargetPath?: string | null
  branchName?: string | null
  worktreePath?: string | null
  commandMetadata?: Record<string, unknown> | null
  resultSummary?: string | null
  artifactRefs?: unknown[] | null
}

export type ChatRuntimeEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_final"; text: string }
  | { type: "tool_activity"; label: string; metadata?: Record<string, unknown> }
  | { type: "checkpoint_candidate"; checkpoint: ChatRuntimeCheckpointCandidate }
  | { type: "runtime_notice"; message: string }
  | { type: "runtime_error"; message: string }

export type ChatRuntimeTurnRequest = {
  chatId: ChatId
  chatSessionId: string
  cwd: string
  prompt: string
  config: ChatRuntimeConfig
  continuationPrompt: string | null
  seedMessages: ChatMessageSnapshot[]
  vendorSessionId: string | null
  signal?: AbortSignal
}

export type RuntimeProcessRunOptions = {
  command: string
  args: string[]
  cwd: string
  stdin?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

export type RuntimeProcessResult = {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  stdoutLines: string[]
  stderrLines: string[]
  timedOut: boolean
}

export type RuntimeProcessRunner = {
  run: (options: RuntimeProcessRunOptions) => Promise<RuntimeProcessResult>
}

export type ChatRuntimeTurnResult = {
  events: ChatRuntimeEvent[]
  finalText: string
  vendorSessionId: string | null
  diagnostics: RuntimeProcessResult
  resumed: boolean
}

export type ChatRuntimeSession = {
  chatId: ChatId
  chatSessionId: string
  provider: ChatRuntimeConfig["provider"]
  model: string
  thinkingLevel: string
  permissionLevel: ChatRuntimeConfig["permissionLevel"]
  cwd: string
  vendorSessionId: string | null
  lastActivityAt: string
  configFingerprint: string
}

export class ChatRuntimeError extends Error {
  constructor(
    readonly kind:
      | "invalid_config"
      | "launch_failed"
      | "protocol_error"
      | "resume_failed"
      | "unexpected_exit"
      | "empty_response",
    message: string,
    readonly diagnostics?: RuntimeProcessResult,
  ) {
    super(message)
  }
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: import("node:child_process").SpawnOptions,
) => ChildProcessWithoutNullStreams

export interface ChatRuntimeAdapter {
  readonly provider: ChatRuntimeConfig["provider"]
  runTurn(request: ChatRuntimeTurnRequest): Promise<ChatRuntimeTurnResult>
}
