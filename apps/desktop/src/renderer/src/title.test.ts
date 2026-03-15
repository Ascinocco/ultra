import { describe, expect, it } from "vitest"

import { getShellTitle } from "./title.js"

describe("desktop shell title", () => {
  it("uses the shared placeholder label", () => {
    expect(getShellTitle()).toBe("Ultra workspace")
  })
})
