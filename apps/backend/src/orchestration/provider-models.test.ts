import { describe, expect, it } from "vitest"
import { getModelForAgent } from "./provider-models.js"

describe("provider-models", () => {
  it("returns Claude opus for lead agent with claude provider", () => {
    expect(getModelForAgent("claude", "lead")).toBe("opus")
  })

  it("returns Claude haiku for scout agent", () => {
    expect(getModelForAgent("claude", "scout")).toBe("haiku")
  })

  it("returns OpenAI o3 for lead agent with openai provider", () => {
    expect(getModelForAgent("openai", "lead")).toBe("o3")
  })

  it("returns Google gemini-flash for scout with google provider", () => {
    expect(getModelForAgent("google", "scout")).toBe("gemini-flash")
  })

  it("falls back to claude models for unknown provider", () => {
    expect(getModelForAgent("unknown", "lead")).toBe("opus")
  })
})
