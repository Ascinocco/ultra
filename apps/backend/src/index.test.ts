import { describe, expect, it } from "vitest"

import { createBackendBanner } from "./index.js"

describe("backend scaffold", () => {
  it("returns a stable placeholder banner", () => {
    expect(createBackendBanner()).toContain("Ultra backend scaffold ready")
  })
})
