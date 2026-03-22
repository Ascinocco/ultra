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

  // Edge cases for the hook's NEAR_BOTTOM_THRESHOLD = 80
  it("returns true when exactly at threshold boundary", () => {
    // scrollBottom = 920, scrollHeight = 1000 → gap = 80 → <= 80 → true
    expect(shouldAutoScroll(920, 1000, 80)).toBe(true)
  })

  it("returns false when one pixel beyond threshold", () => {
    // scrollBottom = 919, scrollHeight = 1000 → gap = 81 → > 80 → false
    expect(shouldAutoScroll(919, 1000, 80)).toBe(false)
  })

  it("returns true when scrolled past bottom (elastic scroll)", () => {
    // scrollBottom > scrollHeight can happen with elastic/rubber-band scrolling
    expect(shouldAutoScroll(1050, 1000, 80)).toBe(true)
  })

  it("returns true for zero-height container", () => {
    expect(shouldAutoScroll(0, 0, 80)).toBe(true)
  })

  it("returns false when scrolled to top of tall content", () => {
    // scrollTop=0, clientHeight=500 → scrollBottom=500, scrollHeight=5000
    expect(shouldAutoScroll(500, 5000, 80)).toBe(false)
  })

  it("handles content growth scenario: near bottom before growth stays near bottom", () => {
    // Before growth: scrollBottom=980, scrollHeight=1000 → near bottom
    expect(shouldAutoScroll(980, 1000, 80)).toBe(true)
    // After growth: scrollBottom still 980 but scrollHeight=1200 → no longer near bottom
    expect(shouldAutoScroll(980, 1200, 80)).toBe(false)
  })
})
