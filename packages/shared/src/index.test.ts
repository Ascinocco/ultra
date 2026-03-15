import { describe, expect, it } from "vitest"

import { APP_NAME, buildPlaceholderProjectLabel } from "./index.js"

describe("shared placeholders", () => {
  it("exports the app name", () => {
    expect(APP_NAME).toBe("Ultra")
  })

  it("builds a stable placeholder label", () => {
    expect(buildPlaceholderProjectLabel("Demo")).toBe("Demo workspace")
  })
})
