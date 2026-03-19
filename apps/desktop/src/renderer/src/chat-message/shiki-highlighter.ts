import { createHighlighter, type Highlighter } from "shiki"

let highlighterPromise: Promise<Highlighter> | null = null

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["material-theme-palenight"],
      langs: [
        "typescript", "javascript", "python", "rust", "go", "json",
        "html", "css", "bash", "sql", "yaml", "toml", "markdown",
        "tsx", "jsx", "c", "cpp", "java", "ruby", "swift", "kotlin",
        "dockerfile", "graphql",
      ],
    })
  }
  return highlighterPromise
}
