import { describe, expect, it } from "vitest"

import { buildSummaryPrompt } from "./workspace-summary.js"

describe("buildSummaryPrompt", () => {
  it("builds prompt with no current description", () => {
    const prompt = buildSummaryPrompt(null, [
      { role: "user", content: "Fix the copy paste bug in our Electron app" },
      { role: "assistant", content: "I'll investigate the app menu..." },
    ])
    expect(prompt).toContain("None yet")
    expect(prompt).toContain("Fix the copy paste bug")
  })

  it("builds prompt with existing description", () => {
    const prompt = buildSummaryPrompt(
      "Fixing copy/paste in Electron app",
      [
        { role: "user", content: "Now add an Edit menu" },
        { role: "assistant", content: "Done, added the Edit menu." },
      ],
    )
    expect(prompt).toContain("Fixing copy/paste in Electron app")
    expect(prompt).toContain("Now add an Edit menu")
  })

  it("truncates messages that are too long", () => {
    const longContent = "x".repeat(2000)
    const prompt = buildSummaryPrompt(null, [
      { role: "user", content: longContent },
    ])
    expect(prompt.length).toBeLessThan(3000)
  })
})
