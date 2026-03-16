import type {
  SupervisedProcessAdapter,
  SupervisedProcessExit,
  SupervisedProcessExitListener,
  SupervisedProcessHandle,
  SupervisedProcessLineListener,
  SupervisedProcessSpec,
} from "./supervised-process-adapter.js"

export class FakeSupervisedProcessHandle implements SupervisedProcessHandle {
  readonly pid: number

  private readonly listeners = new Set<SupervisedProcessExitListener>()
  private readonly stderrListeners = new Set<SupervisedProcessLineListener>()
  private readonly stdoutListeners = new Set<SupervisedProcessLineListener>()

  killCalls = 0
  readonly writtenLines: string[] = []

  constructor(pid: number) {
    this.pid = pid
  }

  kill(_signal?: NodeJS.Signals): void {
    this.killCalls += 1
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

  writeLine(line: string): void {
    this.writtenLines.push(line)
  }

  emitExit(event: SupervisedProcessExit): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  emitStdoutLine(line: string): void {
    for (const listener of this.stdoutListeners) {
      listener(line)
    }
  }

  emitStderrLine(line: string): void {
    for (const listener of this.stderrListeners) {
      listener(line)
    }
  }
}

export type FakeSpawnRecord = {
  handle: FakeSupervisedProcessHandle
  spec: SupervisedProcessSpec
}

export class FakeSupervisedProcessAdapter implements SupervisedProcessAdapter {
  readonly spawns: FakeSpawnRecord[] = []

  private nextPid = 1_000

  spawn(spec: SupervisedProcessSpec): SupervisedProcessHandle {
    const handle = new FakeSupervisedProcessHandle(this.nextPid)
    this.nextPid += 1
    this.spawns.push({
      handle,
      spec,
    })
    return handle
  }
}
