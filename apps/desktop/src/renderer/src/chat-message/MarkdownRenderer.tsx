import { type ReactElement, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import "katex/dist/katex.min.css"
import { CodeBlock } from "./CodeBlock"
import { MermaidBlock } from "./MermaidBlock"
import { MathBlock } from "./MathBlock"

interface MarkdownRendererProps {
  content: string
}

function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("")
  if (children && typeof children === "object" && "props" in children) {
    return extractTextFromChildren(children.props.children)
  }
  return String(children ?? "")
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): ReactElement {
  return (
    <ReactMarkdown
      children={content}
      remarkPlugins={[remarkGfm, remarkMath]}
      components={{
        // Override pre to intercept fenced code blocks (react-markdown renders them as <pre><code>)
        pre({ children, ...props }) {
          if (
            children &&
            typeof children === "object" &&
            "props" in children &&
            (children.props as { node?: { tagName?: string } })?.node?.tagName === "code"
          ) {
            const { className, children: codeChildren } = children.props
            const match = /language-(\w+)/.exec(className || "")
            const language = match ? match[1] : ""
            const value = extractTextFromChildren(codeChildren).replace(/\n$/, "")

            if (language === "mermaid") {
              return <MermaidBlock value={value} />
            }

            return <CodeBlock language={language} value={value} />
          }
          return <pre {...props}>{children}</pre>
        },

        // Inline code only (fenced blocks handled by pre override above)
        code({ children, ...props }) {
          return (
            <code className="chat-inline-code" {...props}>
              {children}
            </code>
          )
        },

        // Math: remark-math produces nodes with className "math math-inline" or "math math-display"
        span({ className, children, ...props }) {
          if (className?.includes("math-inline")) {
            const value = extractTextFromChildren(children)
            return <MathBlock value={value} displayMode={false} />
          }
          return <span className={className} {...props}>{children}</span>
        },

        div({ className, children, ...props }) {
          if (className?.includes("math-display")) {
            const value = extractTextFromChildren(children)
            return <MathBlock value={value} displayMode={true} />
          }
          return <div className={className} {...props}>{children}</div>
        },

        a({ href, children, ...props }) {
          return (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href && window.electron?.shell?.openExternal) {
                  window.electron.shell.openExternal(href)
                }
              }}
              {...props}
            >
              {children}
            </a>
          )
        },

        img({ src, alt, ...props }) {
          const isAllowed =
            src &&
            (src.startsWith("data:") ||
              src.startsWith("file://") ||
              src.startsWith("/"))
          if (!isAllowed) return null

          return (
            <figure className="chat-image">
              <img src={src} alt={alt || ""} {...props} />
              {alt && <figcaption className="chat-image__caption">{alt}</figcaption>}
            </figure>
          )
        },
      }}
    />
  )
}
