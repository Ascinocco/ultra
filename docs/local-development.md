# Ultra Local Development

## Supported M1 Loop

Use these commands from the repo root:

- `pnpm dev`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm build`

## What Each Command Does

### `pnpm dev`

Starts the shared package watcher and the Electron desktop app.

The desktop shell owns backend startup in development, so you do not need to run the backend separately.

### `pnpm typecheck`

Runs the TypeScript project references for the workspace and verifies desktop, backend, and shared packages together.

### `pnpm test`

Runs the current workspace test suites across shared contracts, backend services, and desktop shell behavior.

### `pnpm lint`

Runs Biome checks across the repo.

### `pnpm build`

Builds shared, backend, and desktop production artifacts to confirm the current workspace compiles end to end.

## Startup Failure Behavior

After `ULR-14`, Ultra uses:

- a dedicated startup error gate for backend launch, handshake, and DB bootstrap failures
- a separate readiness blocker for environment prerequisite checks
- inline project-frame messaging for project-open failures

If `pnpm dev` starts the shell but Ultra cannot finish startup, the failure should appear in-app instead of failing silently.
