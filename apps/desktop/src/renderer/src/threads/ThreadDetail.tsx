import type {
  ThreadEventSnapshot,
  ThreadMessageSnapshot,
  ThreadSnapshot,
} from "@ultra/shared"
import { useRef, useState } from "react"

import { CoordinatorMessage } from "./CoordinatorMessage.js"
import { ThreadTimeline } from "./ThreadTimeline.js"

type DetailTab =
  | "overview"
  | "timeline"
  | "agents"
  | "files"
  | "approvals"
  | "logs"

function ThreadOverview({ thread }: { thread: ThreadSnapshot }) {
  return (
    <div className="thread-overview">
      {thread.summary && (
        <p className="thread-overview__summary">{thread.summary}</p>
      )}
      <dl className="thread-overview__fields">
        {thread.branchName && (
          <>
            <dt>Branch</dt>
            <dd>{thread.branchName}</dd>
          </>
        )}
        {thread.prUrl && (
          <>
            <dt>PR</dt>
            <dd>
              <a href={thread.prUrl} target="_blank" rel="noreferrer">
                #{thread.prNumber}
              </a>
            </dd>
          </>
        )}
        <dt>Health</dt>
        <dd>{thread.coordinatorHealth}</dd>
      </dl>
    </div>
  )
}

function CoordinatorConversation({
  messages,
  onSendMessage,
}: {
  messages: ThreadMessageSnapshot[]
  onSendMessage: (content: string) => void
}) {
  const [inputValue, setInputValue] = useState("")
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      onSendMessage(trimmed)
      setInputValue("")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="coordinator-conversation">
      <div className="coordinator-conversation__messages">
        {messages.length === 0 ? (
          <p className="coordinator-conversation__empty">
            No coordinator messages yet
          </p>
        ) : (
          messages.map((msg) => (
            <CoordinatorMessage key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <form
        className="coordinator-conversation__input-dock"
        onSubmit={handleSubmit}
      >
        <input
          ref={inputRef}
          className="coordinator-conversation__input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && inputValue.trim() && !sending) {
              e.preventDefault()
              const form = e.currentTarget.closest("form")
              if (form) form.requestSubmit()
            }
          }}
          placeholder="Message coordinator..."
          aria-label="Message coordinator"
          disabled={sending}
        />
        <button
          className="coordinator-conversation__send"
          type="submit"
          disabled={!inputValue.trim() || sending}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  )
}

export function ThreadDetail({
  thread,
  messages,
  events,
  eventsLoading,
  onBack,
  onSendMessage,
}: {
  thread: ThreadSnapshot
  messages: ThreadMessageSnapshot[]
  events: ThreadEventSnapshot[]
  eventsLoading: boolean
  onBack: () => void
  onSendMessage: (content: string) => void
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview")

  const tabs: { id: DetailTab; label: string; ready: boolean }[] = [
    { id: "overview", label: "Overview", ready: true },
    { id: "timeline", label: "Timeline", ready: true },
    { id: "agents", label: "Agents", ready: false },
    { id: "files", label: "Files", ready: false },
    { id: "approvals", label: "Approvals", ready: false },
    { id: "logs", label: "Logs", ready: false },
  ]

  return (
    <div className="thread-detail">
      <div className="thread-detail__header">
        <button
          className="thread-detail__back"
          type="button"
          onClick={onBack}
          aria-label="Back to thread list"
        >
          &larr;
        </button>
        <h3 className="thread-detail__title">{thread.title}</h3>
        <div className="thread-detail__pills">
          <span className={`state-pill state-pill--${thread.executionState}`}>
            {thread.executionState.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <CoordinatorConversation
        messages={messages}
        onSendMessage={onSendMessage}
      />

      <div className="thread-detail__tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`thread-detail__tab ${activeTab === tab.id ? "thread-detail__tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            disabled={!tab.ready}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="thread-detail__tab-content">
        {activeTab === "overview" && <ThreadOverview thread={thread} />}
        {activeTab === "timeline" && (
          <ThreadTimeline events={events} loading={eventsLoading} />
        )}
        {activeTab === "agents" && (
          <p className="thread-detail__placeholder">
            Agent activity coming soon
          </p>
        )}
        {activeTab === "files" && (
          <p className="thread-detail__placeholder">File changes coming soon</p>
        )}
        {activeTab === "approvals" && (
          <p className="thread-detail__placeholder">
            Approval actions coming soon
          </p>
        )}
        {activeTab === "logs" && (
          <p className="thread-detail__placeholder">Process logs coming soon</p>
        )}
      </div>
    </div>
  )
}
