import { createInterface, type Interface as ReadlineInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"

type PendingRequest = {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type NotificationHandler = (method: string, params: unknown) => void
type RequestHandler = (id: string | number, method: string, params: unknown) => void

const DEFAULT_TIMEOUT_MS = 20_000

export class JsonRpcClient {
  private nextId = 1
  private pending = new Map<string, PendingRequest>()
  private notificationHandler: NotificationHandler | null = null
  private requestHandler: RequestHandler | null = null
  private rl: ReadlineInterface
  private stdin: Writable
  private destroyed = false

  constructor(stdin: Writable, stdout: Readable, private timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.stdin = stdin
    this.rl = createInterface({ input: stdout })
    this.rl.on("line", (line) => this.handleLine(line))
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = String(this.nextId++)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`JSON-RPC request "${method}" timed out after ${this.timeoutMs}ms`))
      }, this.timeoutMs)

      this.pending.set(id, { resolve, reject, timeout })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, params })
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: string | number, code: number, message: string): void {
    this.write({ id, error: { code, message } })
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.rl.close()
    for (const [_id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("JsonRpcClient destroyed"))
    }
    this.pending.clear()
  }

  private write(message: Record<string, unknown>): void {
    if (this.destroyed) return
    this.stdin.write(JSON.stringify(message) + "\n")
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }

    if (typeof parsed !== "object" || parsed === null) return

    // Response to our request (has id, no method)
    if ("id" in parsed && !("method" in parsed)) {
      const pending = this.pending.get(String(parsed.id))
      if (pending) {
        this.pending.delete(String(parsed.id))
        clearTimeout(pending.timeout)
        if (parsed.error) {
          pending.reject(new Error(parsed.error.message ?? `JSON-RPC error ${parsed.error.code}`))
        } else {
          pending.resolve(parsed.result)
        }
      }
      return
    }

    // Server request (has id AND method)
    if ("id" in parsed && "method" in parsed) {
      this.requestHandler?.(parsed.id, parsed.method, parsed.params)
      return
    }

    // Notification (has method, no id)
    if ("method" in parsed && !("id" in parsed)) {
      this.notificationHandler?.(parsed.method, parsed.params)
      return
    }
  }
}
