import { spawn } from "node:child_process"

import type {
  SupervisedProcessAdapter,
  SupervisedProcessExitListener,
  SupervisedProcessHandle,
  SupervisedProcessSpec,
} from "./supervised-process-adapter.js"

class NodeSupervisedProcessHandle implements SupervisedProcessHandle {
  readonly pid: number | null

  private readonly listeners = new Set<SupervisedProcessExitListener>()
  private settled = false

  constructor(spec: SupervisedProcessSpec) {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdio: "ignore",
    })

    this.pid = child.pid ?? null

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

  private emit(event: {
    code: number | null
    error?: string | null
    signal: NodeJS.Signals | null
  }): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export class NodeSupervisedProcessAdapter implements SupervisedProcessAdapter {
  spawn(spec: SupervisedProcessSpec): SupervisedProcessHandle {
    return new NodeSupervisedProcessHandle(spec)
  }
}
