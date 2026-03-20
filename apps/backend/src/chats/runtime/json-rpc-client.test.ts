import { describe, expect, it, vi, beforeEach } from "vitest"
import { JsonRpcClient } from "./json-rpc-client.js"
import { Readable, Writable } from "node:stream"

// Helper: create a fake child process with controllable stdin/stdout
function createFakeProcess() {
  const stdinChunks: string[] = []
  const stdout = new Readable({ read() {} })

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinChunks.push(chunk.toString())
      callback()
    },
  })

  return {
    stdin,
    stdout,
    stdinChunks,
    // Push a JSON-RPC message from "server" to "client"
    pushServerMessage(msg: any) {
      stdout.push(JSON.stringify(msg) + "\n")
    },
    end() {
      stdout.push(null)
    },
  }
}

describe("JsonRpcClient", () => {
  it("sends a request and resolves with matching response", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    // Start request
    const resultPromise = client.request("initialize", { clientInfo: { name: "test" } })

    // Simulate server response after a tick
    await new Promise((r) => setTimeout(r, 10))
    const sentMsg = JSON.parse(proc.stdinChunks[0])
    expect(sentMsg.method).toBe("initialize")
    expect(sentMsg.id).toBeDefined()

    proc.pushServerMessage({ id: sentMsg.id, result: { ok: true } })

    const result = await resultPromise
    expect(result).toEqual({ ok: true })

    client.destroy()
  })

  it("sends a notification (no response expected)", () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    client.notify("initialized")

    const sent = JSON.parse(proc.stdinChunks[0])
    expect(sent.method).toBe("initialized")
    expect(sent.id).toBeUndefined()

    client.destroy()
  })

  it("dispatches server notifications to handler", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)
    const notifications: any[] = []

    client.onNotification((method, params) => {
      notifications.push({ method, params })
    })

    proc.pushServerMessage({ method: "item/agentMessage/delta", params: { delta: "Hello" } })
    await new Promise((r) => setTimeout(r, 20))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toEqual({
      method: "item/agentMessage/delta",
      params: { delta: "Hello" },
    })

    client.destroy()
  })

  it("dispatches server requests to handler and allows responding", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    client.onRequest((id, method, params) => {
      client.respond(id, { decision: "approved" })
    })

    proc.pushServerMessage({
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: { command: "ls" },
    })
    await new Promise((r) => setTimeout(r, 20))

    // Check that response was sent
    const response = JSON.parse(proc.stdinChunks[0])
    expect(response.id).toBe(42)
    expect(response.result).toEqual({ decision: "approved" })

    client.destroy()
  })

  it("rejects request on error response", async () => {
    const proc = createFakeProcess()
    const client = new JsonRpcClient(proc.stdin, proc.stdout)

    const resultPromise = client.request("thread/start", {})

    await new Promise((r) => setTimeout(r, 10))
    const sentMsg = JSON.parse(proc.stdinChunks[0])

    proc.pushServerMessage({
      id: sentMsg.id,
      error: { code: -32601, message: "Method not found" },
    })

    await expect(resultPromise).rejects.toThrow("Method not found")

    client.destroy()
  })
})
