# Ultra CLI Runtime Contract

## Status

Draft v0.1

This document defines the implementation boundary between Ultra and the local coding runtimes it wraps in v1.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)
- [environment-readiness.md](/Users/tony/Projects/ultra/docs/environment-readiness.md)

## Purpose

Ultra is not implementing its own model runtime directly against vendor APIs as the primary v1 path.

Instead, Ultra wraps local coding CLIs and turns them into product-shaped chat and thread behavior.

This doc exists to answer:

`What is the backend-owned contract for running codex CLI and claude code CLI through Ultra?`

## v1 Runtime Set

Ultra should support these local coding runtimes first:

- `codex` CLI
- `claude code` CLI

The Codex path should default to `GPT-5.4` unless the user selects another model target.

## Core Rule

The Ultra backend owns runtime lifecycle.

The renderer never talks directly to `codex` CLI or `claude code` CLI.

All runtime interaction flows through backend services such as:

- `ChatRuntimeAdapter`
- thread/coordinator messaging services where applicable

## Transport Model

Ultra should rely primarily on child-process stdio for local CLI runtime integration.

### Why

- it matches how local coding CLIs are naturally invoked
- it keeps the integration local-first and backend-supervised
- it allows a shared process-management strategy across runtimes

### Rule

Use stdin/stdout as the primary command/result channel.

`stderr` may be captured for diagnostics, but Ultra should not build product state directly from raw stderr text.

### Provider Launch Profiles

Ultra v1 should wrap the coding CLIs with these launch profiles:

- Codex new turn:
  - `codex -a never exec --json -C <cwd> -m <model> -s <sandbox> <prompt>`
- Codex resumed turn:
  - `codex -a never exec resume <sessionId> --json -C <cwd> -m <model> -s <sandbox> <prompt>`
- Claude new turn:
  - `claude -p --output-format stream-json --include-partial-messages --session-id <uuid> --model <model> --permission-mode <mode> <prompt>`
- Claude resumed turn:
  - `claude -p --output-format stream-json --include-partial-messages --resume <sessionId> --model <model> --permission-mode <mode> <prompt>`

These are backend-owned execution details. The rest of Ultra should continue to talk in terms of provider, model, thinking level, permission level, and prompt content.

## Runtime Session Model

Ultra should keep a reusable backend-owned logical runtime session for an active chat when that improves continuity.

The v1 session contract is:

- Ultra keeps one in-memory runtime session record per `chat_id + current_session_id`
- persisted transcript and checkpoint state remain the durable source of truth
- each turn still launches a supervised child process over stdio
- Ultra reattaches that process to a prior vendor session through provider-native resume/session-id support

Ultra must not depend on an undocumented always-on interactive daemon to preserve chat continuity.

### Product Consequence

- persisted chat state remains the source of truth
- runtime sessions are accelerators, not durable product records
- session loss may degrade continuity, but it must not destroy chat ownership or transcript history
- if resume fails, Ultra should invalidate the in-memory runtime session and retry once from persisted chat context

## Required Backend Responsibilities

The backend runtime layer should:

- launch the selected CLI runtime process
- attach project and checkout context
- send user turns and approvals into the runtime
- normalize runtime output into product-shaped messages
- capture structured coding milestones as checkpoints
- terminate or recycle processes when config or lifecycle requires it

## Required Runtime Inputs

At minimum, the runtime adapter should be able to receive:

- `runtime_kind`
- `project_id`
- `chat_id` or `thread_id`
- `cwd`
- `model_target`
- `thinking_level`
- `permission_level`
- user prompt content
- attachment references where applicable

The adapter may derive launch flags and environment from these inputs, but the rest of the product should not need to know those runtime-specific details.

## Runtime Output Normalization

Ultra should normalize runtime outputs into product-domain objects rather than exposing raw CLI transcripts as the main UI model.

### Chat Outputs

The runtime layer should be able to produce:

- assistant text
- structured plan proposals
- structured spec proposals
- activity/result messages for direct coding
- checkpoint-worthy milestone actions
- recoverable runtime errors

### Thread Outputs

Where a runtime contributes to thread/coordinator interaction, the backend should project output into:

- thread messages
- thread events
- thread logs

### Rule

Raw stdio may be stored in logs for debugging.

It is not the primary product model for chat or thread UI.

## Thinking and Permission Mapping

Ultra keeps the user-facing controls:

- `thinking_level`
- `permission_level`

### Thinking

Thinking should map to runtime-native controls where available.

Do not force a fake cross-runtime reasoning enum if the CLIs expose different terminology.

For `ULR-18`:

- `default` must work for both providers
- Codex non-default thinking levels are rejected as invalid config until Ultra owns a documented flag mapping
- Claude may map supported non-default values to `--effort`

### Permissions

`supervised` and `full_access` remain Ultra-owned safety modes.

They are enforced by Ultra's launch policy, approval gating, and command/edit rules, not by pretending they are model identities.

For `ULR-18`, those modes map conservatively to non-blocking CLI settings:

- Codex:
  - `supervised` -> `workspace-write`
  - `full_access` -> `danger-full-access`
- Claude:
  - `supervised` -> `auto`
  - `full_access` -> `bypassPermissions`

The `supervised` mapping must remain non-blocking in this milestone so turns can complete unattended. Interactive approval loops come later.

## Error Model

Runtime failures should normalize into explicit backend errors with enough structure for the UI to respond.

Recommended failure categories:

- runtime not installed
- runtime launch failure
- runtime protocol error
- runtime exited unexpectedly
- invalid config for selected runtime
- turn canceled

### Rule

The user should see actionable failure state without needing to parse raw CLI output.

## Logging and Diagnostics

Ultra should retain enough raw process output to debug runtime issues.

Recommended diagnostic captures:

- process command and version
- launch arguments or launch profile summary
- cwd
- stdout/stderr logs when useful
- exit code and signal

### Rule

Diagnostics belong in logs and support views.

They should not replace normalized transcript and checkpoint records.

## Non-Goals

This contract does not define:

- the full public IPC surface
- vendor API request payloads
- coordinator runtime transport
- browser automation transport

Those are separate boundaries.
