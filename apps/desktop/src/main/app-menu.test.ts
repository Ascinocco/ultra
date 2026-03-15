import { describe, expect, it, vi } from "vitest"

import { createApplicationMenuTemplate } from "./app-menu.js"

describe("createApplicationMenuTemplate", () => {
  it("includes a System & Tools entry that opens the panel", () => {
    const onOpenSystemTools = vi.fn()
    const template = createApplicationMenuTemplate("Ultra", onOpenSystemTools)
    const appMenu = template[0]

    expect(appMenu?.label).toBe("Ultra")

    const menuItems = Array.isArray(appMenu?.submenu) ? appMenu.submenu : []
    const systemToolsItem = menuItems.find(
      (item) =>
        typeof item === "object" &&
        "label" in item &&
        item.label === "System & Tools",
    )

    expect(systemToolsItem).toBeDefined()

    if (
      systemToolsItem &&
      typeof systemToolsItem === "object" &&
      "click" in systemToolsItem &&
      typeof systemToolsItem.click === "function"
    ) {
      systemToolsItem.click({}, {} as never, {} as never)
    }

    expect(onOpenSystemTools).toHaveBeenCalledOnce()
  })
})
