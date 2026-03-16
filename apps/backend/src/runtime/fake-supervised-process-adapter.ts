import type {
  SupervisedProcessAdapter,
  SupervisedProcessExit,
  SupervisedProcessExitListener,
  SupervisedProcessHandle,
  SupervisedProcessSpec,
} from "./supervised-process-adapter.js"

export class FakeSupervisedProcessHandle implements SupervisedProcessHandle {
  readonly pid: number

  private readonly listeners = new Set<SupervisedProcessExitListener>()

  killCalls = 0

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

  emitExit(event: SupervisedProcessExit): void {
    for (const listener of this.listeners) {
      listener(event)
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
