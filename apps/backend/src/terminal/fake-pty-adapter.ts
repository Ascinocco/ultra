import type {
  PtyAdapter,
  PtyDataListener,
  PtyExitInfo,
  PtyExitListener,
  PtySessionHandle,
  PtySpawnOptions,
} from "./pty-adapter.js"

export class FakePtySession implements PtySessionHandle {
  readonly resizeCalls: Array<{ cols: number; rows: number }> = []
  readonly writes: string[] = []

  private readonly dataListeners = new Set<PtyDataListener>()
  private readonly exitListeners = new Set<PtyExitListener>()
  private exited = false

  constructor(readonly options: PtySpawnOptions) {}

  emitData(chunk: string): void {
    for (const listener of this.dataListeners) {
      listener(chunk)
    }
  }

  emitExit(info: PtyExitInfo): void {
    if (this.exited) {
      return
    }

    this.exited = true

    for (const listener of this.exitListeners) {
      listener(info)
    }
  }

  kill(): void {
    this.emitExit({ exitCode: 0 })
  }

  onData(listener: PtyDataListener): () => void {
    this.dataListeners.add(listener)

    return () => {
      this.dataListeners.delete(listener)
    }
  }

  onExit(listener: PtyExitListener): () => void {
    this.exitListeners.add(listener)

    return () => {
      this.exitListeners.delete(listener)
    }
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows })
  }

  write(input: string): void {
    this.writes.push(input)
  }
}

export class FakePtyAdapter implements PtyAdapter {
  readonly sessions: FakePtySession[] = []

  spawn(options: PtySpawnOptions): PtySessionHandle {
    const session = new FakePtySession(options)
    this.sessions.push(session)
    return session
  }
}
