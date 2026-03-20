import { describe, expect, it } from "vitest"
import { shouldAutoScroll } from "./useAutoScroll.js"

describe("shouldAutoScroll", () => {
  it("returns true when near bottom", () => {
    expect(shouldAutoScroll(950, 1000, 50)).toBe(true)
  })

  it("returns false when scrolled up", () => {
    expect(shouldAutoScroll(500, 1000, 50)).toBe(false)
  })

  it("returns true when exactly at bottom", () => {
    expect(shouldAutoScroll(1000, 1000, 50)).toBe(true)
  })

  it("returns true when container has no overflow", () => {
    expect(shouldAutoScroll(300, 300, 50)).toBe(true)
  })
})
