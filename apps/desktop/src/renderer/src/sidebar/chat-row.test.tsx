import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { makeChat } from "../test-utils/factories.js"
import { ChatRow } from "./ChatRow.js"

describe("ChatRow", () => {
  it("renders an editable title input during rename", () => {
    const chat = makeChat("c1", "proj-1", { title: "Planning" })
    const markup = renderToStaticMarkup(
      <ChatRow
        chat={chat}
        isActive={false}
        onSelect={() => undefined}
        onContextMenu={() => undefined}
        isEditing
        renameDraft="Renamed planning"
      />,
    )

    expect(markup).toContain("chat-row__rename-input")
    expect(markup).toContain('value="Renamed planning"')
    expect(markup).toContain('aria-label="Rename Planning"')
  })

  it("renders a normal chat row button when not renaming", () => {
    const chat = makeChat("c1", "proj-1", { title: "Planning" })
    const markup = renderToStaticMarkup(
      <ChatRow
        chat={chat}
        isActive={false}
        onSelect={() => undefined}
        onContextMenu={() => undefined}
      />,
    )

    expect(markup).toContain("<button")
    expect(markup).toContain("Planning")
    expect(markup).not.toContain("chat-row__rename-input")
  })
})
