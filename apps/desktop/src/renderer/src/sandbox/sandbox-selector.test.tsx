import type { SandboxContextSnapshot } from "@ultra/shared"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { makeSandbox } from "../test-utils/factories.js"
import { SandboxSelector } from "./SandboxSelector.js"

const mainSandbox = makeSandbox("sb-1", "proj-1", {
  displayName: "main checkout",
  branchName: "main",
  isMainCheckout: true,
})

const featureSandbox = makeSandbox("sb-2", "proj-1", {
  displayName: "feature/auth",
  branchName: "feature/auth",
  isMainCheckout: false,
})

function renderSelector(
  props?: Partial<{
    activeSandbox: SandboxContextSnapshot | null
    sandboxes: SandboxContextSnapshot[]
    onSelect: (id: string) => void
  }>,
) {
  return renderToStaticMarkup(
    <SandboxSelector
      activeSandbox={mainSandbox}
      sandboxes={[mainSandbox, featureSandbox]}
      onSelect={() => undefined}
      {...props}
    />,
  )
}

describe("SandboxSelector", () => {
  it("renders the selector pill with active sandbox name", () => {
    const markup = renderSelector()

    expect(markup).toContain("sandbox-selector")
    expect(markup).toContain("main checkout")
  })

  it("renders sandbox-selector__pill class", () => {
    const markup = renderSelector()

    expect(markup).toContain("sandbox-selector__pill")
  })

  it("renders the branch icon", () => {
    const markup = renderSelector()

    expect(markup).toContain("sandbox-selector__icon")
  })

  it("shows fallback text when no active sandbox", () => {
    const markup = renderSelector({ activeSandbox: null })

    expect(markup).toContain("No sandbox")
  })

  it("shows loading text when sandboxes array is empty and active is null", () => {
    const markup = renderSelector({ activeSandbox: null, sandboxes: [] })

    expect(markup).toContain("No sandbox")
  })
})
