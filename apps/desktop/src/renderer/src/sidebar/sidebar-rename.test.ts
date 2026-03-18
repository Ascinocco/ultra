import { describe, expect, it } from "vitest"

import { resolveRenamedChatTitle } from "./Sidebar.js"

describe("resolveRenamedChatTitle", () => {
  it("returns a trimmed title when the value changes", () => {
    expect(resolveRenamedChatTitle("Old title", "  New title  ")).toBe(
      "New title",
    )
  })

  it("returns null for unchanged values", () => {
    expect(resolveRenamedChatTitle("Old title", "Old title")).toBeNull()
    expect(resolveRenamedChatTitle("Old title", "  Old title  ")).toBeNull()
  })

  it("returns null for blank values", () => {
    expect(resolveRenamedChatTitle("Old title", "")).toBeNull()
    expect(resolveRenamedChatTitle("Old title", "   ")).toBeNull()
  })
})
