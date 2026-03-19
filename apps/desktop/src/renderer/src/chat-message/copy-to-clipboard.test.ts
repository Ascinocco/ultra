import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { copyToClipboard } from "./copy-to-clipboard"

describe("copyToClipboard", () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    writeTextMock.mockClear()
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("copies text to clipboard and returns true", async () => {
    const result = await copyToClipboard("hello world")
    expect(writeTextMock).toHaveBeenCalledWith("hello world")
    expect(result).toBe(true)
  })

  it("returns false when clipboard write fails", async () => {
    writeTextMock.mockRejectedValueOnce(new Error("denied"))
    const result = await copyToClipboard("hello")
    expect(result).toBe(false)
  })
})
