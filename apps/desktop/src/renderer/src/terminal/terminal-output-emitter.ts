export type OutputHandler = (chunk: string) => void

export class TerminalOutputEmitter {
  private handlers = new Map<string, Set<OutputHandler>>()

  on(sessionId: string, handler: OutputHandler): void {
    let set = this.handlers.get(sessionId)
    if (!set) {
      set = new Set()
      this.handlers.set(sessionId, set)
    }
    set.add(handler)
  }

  off(sessionId: string, handler: OutputHandler): void {
    const set = this.handlers.get(sessionId)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) this.handlers.delete(sessionId)
  }

  emit(sessionId: string, chunk: string): void {
    const set = this.handlers.get(sessionId)
    if (!set) return
    for (const handler of set) {
      handler(chunk)
    }
  }
}

export const terminalOutputEmitter = new TerminalOutputEmitter()
