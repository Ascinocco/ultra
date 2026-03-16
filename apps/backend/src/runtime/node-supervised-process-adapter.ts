import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

import type {
  SupervisedProcessAdapter,
  SupervisedProcessExitListener,
  SupervisedProcessHandle,
  SupervisedProcessLineListener,
  SupervisedProcessSpec,
} from "./supervised-process-adapter.js"

class NodeSupervisedProcessHandle implements SupervisedProcessHandle {
  readonly pid: number | null

  private readonly listeners = new Set<SupervisedProcessExitListener>()
  private readonly stderrListeners = new Set<SupervisedProcessLineListener>()
  private readonly stdoutListeners = new Set<SupervisedProcessLineListener>()
  private settled = false

  constructor(spec: SupervisedProcessSpec) {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdio: "pipe",
    })

    this.pid = child.pid ?? null
    const stdoutReader = child.stdout
      ? createInterface({ input: child.stdout })
      : null
    const stderrReader = child.stderr
      ? createInterface({ input: child.stderr })
      : null

    stdoutReader?.on("line", (line) => {
      this.emitStdout(line)
    })
    stderrReader?.on("line", (line) => {
      this.emitStderr(line)
    })

    child.once("error", (error) => {
      if (this.settled) {
        return
      }

      this.settled = true
      this.emit({
        code: null,
        error: error.message,
        signal: null,
      })
    })

    child.once("exit", (code, signal) => {
      if (this.settled) {
        return
      }

      this.settled = true
      this.emit({
        code,
        signal,
      })
    })

    this.kill = (signal?: NodeJS.Signals) => {
      child.kill(signal)
    }
    this.writeLine = (line: string) => {
      if (!child.stdin || child.stdin.destroyed) {
        throw new Error("Supervised process stdin is unavailable.")
      }

      child.stdin.write(`${line}\n`)
    }
  }

  kill(_signal?: NodeJS.Signals): void {
    throw new Error("kill is assigned during construction")
  }

  onExit(listener: SupervisedProcessExitListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  onStdoutLine(listener: SupervisedProcessLineListener): () => void {
    this.stdoutListeners.add(listener)

    return () => {
      this.stdoutListeners.delete(listener)
    }
  }

  onStderrLine(listener: SupervisedProcessLineListener): () => void {
    this.stderrListeners.add(listener)

    return () => {
      this.stderrListeners.delete(listener)
    }
  }

  writeLine(_line: string): void {
    throw new Error("writeLine is assigned during construction")
  }

  private emit(event: {
    code: number | null
    error?: string | null
    signal: NodeJS.Signals | null
  }): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private emitStdout(line: string): void {
    for (const listener of this.stdoutListeners) {
      listener(line)
    }
  }

  private emitStderr(line: string): void {
    for (const listener of this.stderrListeners) {
      listener(line)
    }
  }
}

export class NodeSupervisedProcessAdapter implements SupervisedProcessAdapter {
  spawn(spec: SupervisedProcessSpec): SupervisedProcessHandle {
    return new NodeSupervisedProcessHandle(spec)
  }
}
