import { describe, expect, it } from "vitest"
import { runtimeComponentTypeSchema } from "./runtime.js"

describe("runtimeComponentTypeSchema", () => {
  it("accepts agent as a valid component type", () => {
    const result = runtimeComponentTypeSchema.safeParse("agent")
    expect(result.success).toBe(true)
  })

  it("still accepts existing types", () => {
    for (const type of ["coordinator", "watchdog", "ov_watch"]) {
      expect(runtimeComponentTypeSchema.safeParse(type).success).toBe(true)
    }
  })
})
