import { useState } from 'react'
import { User, Bot, ChevronDown, ChevronUp } from 'lucide-react'

const MAX_PREVIEW = 280

function MessageLine({ message }) {
  const isAgent = message.sender === 'agent' || message.who === 'agent'
  const isBot = message.isBot || message.bot
  const text = message.text || ''
  const [expanded, setExpanded] = useState(false)
  const long = text.length > MAX_PREVIEW
  const display = long && !expanded ? `${text.slice(0, MAX_PREVIEW)}…` : text

  return (
    <div className="flex gap-2 text-sm justify-start">
      <span className="shrink-0 mt-0.5 text-steel">
        {isBot ? <Bot size={14} /> : isAgent ? <User size={14} className="text-primary" /> : <User size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-ink-muted">
          {isAgent ? (isBot ? 'bot' : 'agent') : 'customer'}
        </span>
        <p className="text-ink-primary whitespace-pre-wrap break-words">{display || '—'}</p>
        {long && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-primary hover:underline mt-0.5">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Compact inline transcript for Review Queue draft cards.
 * @param {{ conversation?: object, maxHeight?: string }} props
 */
export default function DraftTranscriptPreview({ conversation, maxHeight = 'max-h-96' }) {
  const [collapsed, setCollapsed] = useState(false)
  const messages = conversation?.messages || []

  if (!conversation) {
    return (
      <div className="rounded-lg border border-sky-border bg-sky-soft/50 px-3 py-2 text-sm text-ink-primary">
        Transcript unavailable for this draft.
      </div>
    )
  }

  if (!messages.length) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-ink-muted">
        No messages in transcript.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-ink-primary bg-surface-muted hover:bg-surface-muted"
      >
        <span>
          Transcript · {conversation.contact || 'Customer'} · {messages.length} messages
        </span>
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {!collapsed && (
        <div className={`px-3 py-2 space-y-2 overflow-y-auto ${maxHeight}`}>
          {messages.map((m, i) => (
            <MessageLine key={i} message={m} />
          ))}
        </div>
      )}
    </div>
  )
}
