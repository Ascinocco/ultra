import { describe, expect, it } from "vitest"
import { sanitize, sanitizeObject } from "./sanitizer.js"

describe("sanitizer", () => {
  it("redacts Anthropic API keys", () => {
    expect(sanitize("key: sk-ant-abc123xyz")).toBe("key: [REDACTED]")
  })

  it("redacts GitHub PATs", () => {
    expect(sanitize("token: github_pat_abc123")).toBe("token: [REDACTED]")
    expect(sanitize("token: ghp_abc123")).toBe("token: [REDACTED]")
  })

  it("redacts Bearer tokens", () => {
    expect(sanitize("Authorization: Bearer eyJhbGc")).toBe("Authorization: Bearer [REDACTED]")
  })

  it("leaves clean strings unchanged", () => {
    expect(sanitize("hello world")).toBe("hello world")
  })

  it("sanitizes nested object values", () => {
    const obj = { key: "sk-ant-secret123", nested: { token: "ghp_abc" } }
    const result = sanitizeObject(obj)
    expect(result.key).toBe("[REDACTED]")
    expect((result.nested as any).token).toBe("[REDACTED]")
  })
})
