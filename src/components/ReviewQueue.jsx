import { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, X, ClipboardCheck, AlertCircle, Pencil, ChevronDown, ChevronUp, MessageSquare, Star } from 'lucide-react'
import { fetchConfig, fetchDrafts, approveDraft, rejectDraft } from '../utils/api'
import { PASS_THRESHOLD } from '../utils/defaultScorecardConfig'
import {
  suggestApproveComments,
  verdictClasses,
  scoreDiff,
  sumCriterionScores,
  buildPerfectScores,
  draftLikeFromScores,
} from '../utils/draftReviewHelpers'
import DraftTranscriptPreview from './DraftTranscriptPreview'
import ReviewQueueCriterionScores from './ReviewQueueCriterionScores'
import VerdictBadge from './VerdictBadge'

const REVIEWER = 'Reviewer 01'

const STATUS_OPTIONS = [
  { value: 'pending_human_review', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function SimilarScoreCard({ example, onUseComment }) {
  const tone = verdictClasses(example.totalScore)
  return (
    <div className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-ink-muted truncate max-w-[160px]" title={example.conversationId}>
          {example.conversationId}
        </span>
        <span className={`score-chip ${tone.badge}`}>{example.totalScore}/100</span>
      </div>
      {example.comments && <p className="text-ink-primary whitespace-pre-wrap italic">&ldquo;{example.comments}&rdquo;</p>}
      {example.comments && onUseComment && (
        <button type="button" onClick={() => onUseComment(example.comments)} className="text-xs text-primary hover:underline flex items-center gap-1">
          <MessageSquare size={11} />
          Use style
        </button>
      )}
    </div>
  )
}

function DraftQueueItem({ draft, active, onSelect }) {
  const approvedTotal = draft.approvedScore?.totalScore
  const displayTotal = approvedTotal != null ? approvedTotal : draft.totalScore
  const tone = verdictClasses(displayTotal)
  const showAiHint = approvedTotal != null && approvedTotal !== draft.totalScore
  const high = draft.status === 'pending_human_review' && draft.reviewPriority?.tier === 'high'

  return (
    <button type="button" onClick={() => onSelect(draft.id)} className={`queue-item ${active ? 'queue-item-active' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs text-ink-primary truncate" title={draft.conversationId}>
          {draft.conversationId}
        </p>
        {high && <span className="rounded bg-warning/15 px-1 text-[9px] font-semibold uppercase text-warning">review first</span>}
        {draft.status !== 'pending_human_review' && (
          <span className="rounded bg-surface-muted px-1 text-[9px] font-semibold uppercase text-ink-muted">{draft.status}</span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted truncate">{draft.conversation?.agent || 'Agent unknown'}</span>
        <div className="flex flex-col items-end shrink-0">
          <span className={`text-xs font-bold tabular-nums ${tone.text}`}>{displayTotal}</span>
          {showAiHint && <span className="text-[9px] tabular-nums text-ink-muted line-through">AI {draft.totalScore}</span>}
        </div>
      </div>
    </button>
  )
}

function ScoresPanel({ draft, scorecardStructure, onApprove, onReject, busy, error }) {
  const isPending = draft.status === 'pending_human_review'
  const approved = draft.approvedScore
  const [editing, setEditing] = useState(false)
  const [editedScores, setEditedScores] = useState(() => ({ ...draft.draftScores }))
  const [comments, setComments] = useState(() => suggestApproveComments(draft))
  const [commentsDirty, setCommentsDirty] = useState(false)
  const [calibrationNote, setCalibrationNote] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [similarExpanded, setSimilarExpanded] = useState(false)

  const aiScores = draft.draftScores && typeof draft.draftScores === 'object' ? draft.draftScores : {}
  const shown = isPending ? aiScores : draft.finalScores ?? aiScores
  const diffCount = scoreDiff(draft.draftScores, editedScores).length
  const editedTotal = useMemo(() => sumCriterionScores(editedScores), [editedScores])
  const showEditedTotal = isPending && (editing || diffCount > 0)
  const displayTotal = isPending ? (showEditedTotal ? editedTotal : draft.totalScore) : approved?.totalScore ?? draft.totalScore
  const similar = draft.similarHumanScores || []

  const suggestionSource = useMemo(
    () => (isPending && (diffCount > 0 || editing) ? draftLikeFromScores(editedScores, editedTotal) : draft),
    [isPending, draft, diffCount, editing, editedScores, editedTotal],
  )

  useEffect(() => {
    if (!isPending || !editing || commentsDirty) return
    setComments(suggestApproveComments(suggestionSource))
  }, [isPending, editing, commentsDirty, suggestionSource])

  const handlePerfect = () => {
    const perfect = buildPerfectScores(scorecardStructure)
    setEditedScores(perfect)
    setEditing(true)
    setCommentsDirty(false)
    setComments(suggestApproveComments(draftLikeFromScores(perfect, sumCriterionScores(perfect))))
  }

  const handleApprove = () => {
    const payload = { reviewer: REVIEWER, comments: comments.trim() || suggestApproveComments(suggestionSource) }
    if (diffCount > 0) payload.scores = Object.fromEntries(Object.entries(editedScores).map(([k, v]) => [k, typeof v === 'object' ? v.points : v]))
    if (calibrationNote.trim()) payload.reviewNote = calibrationNote.trim()
    onApprove(draft.id, payload)
  }

  return (
    <div className="workstation-panel h-full flex flex-col">
      <div className="workstation-panel-header">Scores &amp; review</div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isPending && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-ink-primary space-y-1">
            <p className="font-semibold">Nothing here is official yet</p>
            <p className="text-ink-muted">
              Wrong draft? Reject with a clear reason. Points off? Edit the criteria, then Approve. Both feed the next batch.
            </p>
          </div>
        )}

        {!isPending && approved && (
          <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs space-y-1">
            <p className="font-semibold text-success">Approved &amp; saved</p>
            <p className="text-ink-muted">
              Official score stored{approved.scoredBy ? ` by ${approved.scoredBy}` : ''} ({approved.scoreOrigin}) on {formatDate(approved.scoredDate)}.
            </p>
          </div>
        )}

        <div className="flex flex-col items-center gap-1">
          <VerdictBadge totalScore={displayTotal} size="md" />
          {isPending && draft.reviewPriority?.tier === 'high' && (
            <span
              className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
              title={draft.reviewPriority.borderline ? 'Near the pass mark: your call decides pass/fail' : 'Low agent confidence: needs a closer look'}
            >
              Review first
            </span>
          )}
          {typeof draft.confidence === 'number' && (
            <span className="text-[10px] tabular-nums text-ink-muted" title="Agent self-reported confidence">
              {Math.round(draft.confidence * 100)}% confidence
            </span>
          )}
          {isPending && showEditedTotal && editedTotal !== draft.totalScore && (
            <p className="text-[10px] tabular-nums text-ink-muted" aria-live="polite">
              AI draft <span className="line-through opacity-70">{draft.totalScore}</span>
              {' → '}
              <span className="font-semibold text-ink-primary">your edit</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{isPending ? 'Criteria' : 'Final criteria'}</p>
          {isPending && (
            <div className="flex items-center gap-1">
              <button type="button" onClick={handlePerfect} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-ink-muted hover:bg-sky-soft/50" title="Fill with full marks (100/100)">
                <Star size={12} />
              </button>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${editing ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:bg-surface-muted'}`}
                title="Edit points before approving; each change becomes a learning signal"
              >
                <Pencil size={12} />
                {editing ? 'Editing' : 'Edit'}
              </button>
            </div>
          )}
        </div>

        {isPending && diffCount > 0 && (
          <p className="text-xs text-primary">
            {diffCount} criterion{diffCount === 1 ? '' : 's'} changed. Approving records the correction.
          </p>
        )}

        <ReviewQueueCriterionScores
          scores={shown}
          scorecardStructure={scorecardStructure}
          editing={editing && isPending}
          editedScores={editedScores}
          onEditScores={setEditedScores}
        />

        {similar.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setSimilarExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink-primary"
            >
              {similarExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Similar human scores ({similar.length})
            </button>
            {similarExpanded && (
              <div className="mt-2 space-y-1.5">
                {similar.map((ex) => (
                  <SimilarScoreCard key={ex.conversationId} example={ex} onUseComment={isPending ? setComments : undefined} />
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error/10 border border-error/30 px-2 py-1.5 text-xs text-error" role="alert">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {!isPending && (draft.reviewNote || approved?.comments) && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-muted/80 p-2 text-sm">
            {draft.reviewNote && (
              <p>
                <span className="text-[10px] font-medium text-ink-muted block">{draft.status === 'rejected' ? 'Rejection reason' : 'Reviewer note'}</span>
                {draft.reviewNote}
              </p>
            )}
            {approved?.comments && (
              <p>
                <span className="text-[10px] font-medium text-ink-muted block">Reviewer comments</span>
                {approved.comments}
              </p>
            )}
          </div>
        )}

        {isPending && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-muted/80 p-2">
            <p className="text-xs font-semibold text-ink-primary">Reviewer comments</p>
            <textarea
              value={comments}
              onChange={(e) => {
                setCommentsDirty(true)
                setComments(e.target.value)
              }}
              rows={3}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => {
                setCommentsDirty(false)
                setComments(suggestApproveComments(suggestionSource))
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-muted"
            >
              Suggest
            </button>
            <label className="block text-[10px] font-medium text-ink-muted">Calibration note (optional): why you changed points</label>
            <textarea
              value={calibrationNote}
              onChange={(e) => setCalibrationNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}
      </div>

      {isPending && (
        <div className="shrink-0 border-t border-border bg-surface-muted/50 p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleApprove} disabled={Boolean(busy)} className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-sm disabled:opacity-50 min-w-[120px]">
              <Check size={16} />
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              onClick={() => setShowReject((v) => !v)}
              disabled={Boolean(busy)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm text-error bg-error/10 hover:bg-error/15 disabled:opacity-50 min-w-[120px]"
            >
              <X size={16} />
              Reject
            </button>
          </div>
          {showReject && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-ink-primary">
                Reason <span className="text-error">(required)</span>
              </label>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={2}
                placeholder="Why this draft is wrong. The agent reads this next session."
                className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => onReject(draft.id, rejectNote.trim())}
                disabled={Boolean(busy) || !rejectNote.trim()}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium text-white bg-error hover:bg-error/90 disabled:opacity-50"
              >
                {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
              </button>
            </div>
          )}
          <p className="text-[10px] text-ink-muted text-center">j / k or arrow keys switch drafts</p>
        </div>
      )}
    </div>
  )
}

export default function ReviewQueue() {
  const [statusFilter, setStatusFilter] = useState('pending_human_review')
  const [drafts, setDrafts] = useState([])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [reasoningExpanded, setReasoningExpanded] = useState(true)
  const [banner, setBanner] = useState(null)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [cfg, list] = await Promise.all([fetchConfig(), fetchDrafts(statusFilter)])
      setConfig(cfg)
      setDrafts(list)
      setSelectedId((prev) => (list.some((d) => d.id === prev) ? prev : list[0]?.id ?? null))
    } catch (err) {
      setLoadError(err?.message || 'Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const selectedIndex = drafts.findIndex((d) => d.id === selectedId)
  const selectedDraft = selectedIndex >= 0 ? drafts[selectedIndex] : null

  const selectAdjacent = useCallback(
    (delta) => {
      if (!drafts.length) return
      const next = Math.max(0, Math.min(drafts.length - 1, (selectedIndex < 0 ? 0 : selectedIndex) + delta))
      setSelectedId(drafts[next].id)
    },
    [drafts, selectedIndex],
  )

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        selectAdjacent(1)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        selectAdjacent(-1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectAdjacent])

  const flash = (message, type = 'success') => {
    setBanner({ type, message })
    setTimeout(() => setBanner(null), 5000)
  }

  const afterReview = (id) => {
    const idx = drafts.findIndex((d) => d.id === id)
    const rest = drafts.filter((d) => d.id !== id)
    setDrafts(rest)
    setSelectedId(rest[Math.min(idx, rest.length - 1)]?.id ?? null)
  }

  const handleApprove = async (id, payload) => {
    setBusy('approve')
    setActionError(null)
    try {
      const result = await approveDraft(id, payload)
      afterReview(id)
      const draft = drafts.find((d) => d.id === id)
      const diffCount = payload.scores && draft ? scoreDiff(draft.draftScores, payload.scores).length : 0
      flash(`Approved. Official score ${result.score.totalScore}/100 saved.${diffCount ? ` ${diffCount} correction(s) recorded as learning signals.` : ''}`)
    } catch (err) {
      setActionError(err?.message || 'Approve failed')
    } finally {
      setBusy(null)
    }
  }

  const handleReject = async (id, reason) => {
    setBusy('reject')
    setActionError(null)
    try {
      await rejectDraft(id, reason, REVIEWER)
      afterReview(id)
      flash('Draft rejected. The reason is saved as a learning signal for the next batch.')
    } catch (err) {
      setActionError(err?.message || 'Reject failed')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => setActionError(null), [selectedId])

  const isPendingFilter = statusFilter === 'pending_human_review'
  const scorecardStructure = config?.scorecardStructure

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="heading-page">Review Queue</h2>
          <p className="text-sm text-ink-muted mt-1">AI draft workstation · Pass mark {config?.passThreshold ?? PASS_THRESHOLD}/100</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${statusFilter === opt.value ? 'bg-primary text-white' : 'bg-surface text-ink-muted hover:bg-surface-muted'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <div className={`rounded-lg px-4 py-3 text-sm ${banner.type === 'success' ? 'bg-success/10 border border-success/20 text-success' : 'bg-error/10 border border-error/30 text-error'}`}>
          {banner.message}
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg bg-error/10 border border-error/30 px-4 py-3 text-sm text-error">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Could not load drafts</p>
            <p>{loadError}. Is the API running (npm run dev)?</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="data-surface flex items-center justify-center py-16 text-ink-muted">Loading drafts…</div>
      ) : drafts.length === 0 ? (
        <div className="data-surface flex flex-col items-center justify-center py-16 text-ink-muted">
          <ClipboardCheck size={40} className="mb-3 text-steel" />
          <p className="font-medium text-ink-primary">{isPendingFilter ? 'No drafts awaiting review' : `No ${statusFilter.replace(/_/g, ' ')} drafts`}</p>
          {isPendingFilter && <p className="text-sm mt-1">Run <code>npm run batch</code> to have the agent draft some scores.</p>}
        </div>
      ) : (
        selectedDraft && (
          <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,420px)]" style={{ minHeight: '70vh' }}>
            <aside className="workstation-panel max-h-[calc(100vh-10rem)]">
              <div className="workstation-panel-header">Queue ({drafts.length})</div>
              <div className="flex-1 overflow-y-auto">
                {drafts.map((d) => (
                  <DraftQueueItem key={d.id} draft={d} active={d.id === selectedId} onSelect={setSelectedId} />
                ))}
              </div>
            </aside>

            <div className="workstation-panel max-h-[calc(100vh-10rem)]">
              <div className="workstation-panel-header">Transcript</div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <div className="text-xs text-ink-muted space-y-0.5">
                  <p className="font-mono text-ink-primary break-all">{selectedDraft.conversationId}</p>
                  {selectedDraft.conversation?.agent && (
                    <p>
                      Agent: {selectedDraft.conversation.agent} · {selectedDraft.conversation.date}
                    </p>
                  )}
                  <p>
                    Drafted {formatDate(selectedDraft.createdAt)}
                    {selectedDraft.reviewedAt && <> · Reviewed {formatDate(selectedDraft.reviewedAt)} by {selectedDraft.reviewedBy}</>}
                  </p>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-surface-muted text-ink-muted">
                    {selectedDraft.model || 'unknown model'}
                  </span>
                </div>

                <DraftTranscriptPreview conversation={selectedDraft.conversation} />

                <div>
                  <button
                    type="button"
                    onClick={() => setReasoningExpanded((v) => !v)}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink-primary"
                  >
                    {reasoningExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    AI reasoning
                  </button>
                  {reasoningExpanded && (
                    <div className="mt-2 rounded-lg bg-surface-muted border border-border px-2 py-2 text-sm text-ink-primary whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {selectedDraft.reasoning || 'No reasoning provided.'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-10rem)] flex flex-col">
              <ScoresPanel
                key={selectedDraft.id}
                draft={selectedDraft}
                scorecardStructure={scorecardStructure}
                onApprove={handleApprove}
                onReject={handleReject}
                busy={busy}
                error={actionError}
              />
            </div>
          </div>
        )
      )}
    </div>
  )
}
