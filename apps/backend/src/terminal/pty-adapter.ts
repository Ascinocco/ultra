import { type IPty, spawn } from "node-pty"

export type PtySpawnOptions = {
  args: string[]
  cols: number
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  rows: number
}

export type PtyExitInfo = {
  exitCode: number
  signal?: number
}

export type PtyDataListener = (chunk: string) => void
export type PtyExitListener = (info: PtyExitInfo) => void

export type PtySessionHandle = {
  kill: () => void
  onData: (listener: PtyDataListener) => () => void
  onExit: (listener: PtyExitListener) => () => void
  resize: (cols: number, rows: number) => void
  write: (input: string) => void
}

export type PtyAdapter = {
  spawn: (options: PtySpawnOptions) => PtySessionHandle
}

function buildDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "cmd.exe"
  }

  return process.env.SHELL ?? "/bin/bash"
}

function normalizeEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const entries = Object.entries(environment).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  )

  return Object.fromEntries(entries)
}

export function getDefaultShellCommand(): string {
  return buildDefaultShell()
}

export class NodePtyAdapter implements PtyAdapter {
  spawn(options: PtySpawnOptions): PtySessionHandle {
    const processHandle = spawn(options.command, options.args, {
      name: "xterm-color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: normalizeEnvironment(options.env),
    })

    return createPtySessionHandle(processHandle)
  }
}

function createPtySessionHandle(processHandle: IPty): PtySessionHandle {
  return {
    write(input) {
      processHandle.write(input)
    },
    resize(cols, rows) {
      processHandle.resize(cols, rows)
    },
    kill() {
      processHandle.kill()
    },
    onData(listener) {
      const disposable = processHandle.onData(listener)

      return () => {
        disposable.dispose()
      }
    },
    onExit(listener) {
      const disposable = processHandle.onExit(listener)

      return () => {
        disposable.dispose()
      }
    },
  }
}
