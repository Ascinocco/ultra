# Ultra Environment Readiness

## Status

Draft v0.1

Related specs:

- [cli-runtime-contract.md](/Users/tony/Projects/ultra/docs/cli-runtime-contract.md)
- [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md)
- [implementation-plan/01-foundations-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/01-foundations-architecture.md)

## Purpose

Ultra depends on local CLI tools that must be available before the app can safely hand work to Overstory and the coding runtimes it supervises.

This document defines:

- which tools Ultra probes
- which tools block the app in each session type
- how Ultra checks them
- where readiness appears in the product

## Session Scopes

Ultra distinguishes between two dependency scopes:

- `runtime-required`
- `developer-required`

### Runtime-Required Tools

These tools block packaged desktop usage and local development sessions:

- `git`
- `ov`
- `tmux`
- `sd`
- `codex`
- `claude`

### Developer-Required Tools

These tools block local contributor sessions, but not packaged desktop runtime sessions:

- `node`
- `pnpm`

## Blocking Rules

- Packaged or normal desktop runtime sessions block only on `runtime-required` tools.
- Local contributor and development sessions block on both `runtime-required` and `developer-required` tools.
- `sd` is required because Overstory depends on Seeds.
- Claude Code is detected through the `claude` binary.
- Ultra uses PATH-based resolution only in v1.
- Ultra does not support custom executable path settings in v1.
- Ultra does not auto-install missing tools.

## Probe Commands

Ultra probes tools with these commands:

- `node --version`
- `pnpm --version`
- `git --version`
- `tmux -V`
- `sd --version`
- `ov --version`
- `codex --version`
- `claude --version`

## Version Policy

- `node` and `pnpm` are validated against the repo's current `engines` and `packageManager` constraints.
- Third-party CLIs are checked for presence plus successful version probe.
- Ultra should not report a third-party CLI as `unsupported` until the project defines an explicit minimum supported version for that tool.

## Product Surfaces

Environment readiness does not appear in:

- the main shell header
- the project frame
- the runtime indicator

Instead, Ultra uses two surfaces:

1. a blocking startup readiness screen shown after handshake if required tools are not ready
2. a minimal `Settings > System & Tools` surface that shows the same snapshot later

## Startup Sequence

Ultra startup remains:

1. desktop launches backend
2. backend boots persistence and socket services
3. renderer completes `system.hello`
4. renderer requests the readiness snapshot
5. renderer either enters the normal shell or shows the blocking readiness screen

Readiness is a backend-owned service queried after handshake. It is not folded into `system.hello`.
