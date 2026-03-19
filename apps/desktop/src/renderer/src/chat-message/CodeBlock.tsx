import { useState, useEffect, type ReactElement } from "react"
import { getHighlighter } from "./shiki-highlighter"
import { copyToClipboard } from "./copy-to-clipboard"

interface CodeBlockProps {
  language: string
  value: string
}

export function CodeBlock({ language, value }: CodeBlockProps): ReactElement {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    getHighlighter().then((highlighter) => {
      if (cancelled) return
      try {
        const html = highlighter.codeToHtml(value, {
          lang: language || "text",
          theme: "material-theme-palenight",
        })
        setHighlightedHtml(html)
      } catch {
        setHighlightedHtml(null)
      }
    })
    return () => { cancelled = true }
  }, [language, value])

  const handleCopy = async () => {
    const success = await copyToClipboard(value)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="chat-code-block">
      <div className="chat-code-block__header">
        {language && (
          <span className="chat-code-block__language">{language}</span>
        )}
        <button
          className="chat-code-block__copy"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="chat-code-block__body">
        {highlightedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <pre><code>{value}</code></pre>
        )}
      </div>
    </div>
  )
}
