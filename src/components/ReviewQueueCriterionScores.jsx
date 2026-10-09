import {
  buildCriterionMeta,
  clampCriterionScore,
  criterionScoreClasses,
  sectionScoreClasses,
  sectionScoreTotals,
  pointsOf,
  evidenceOf,
  isComputedCriterion,
} from '../utils/draftReviewHelpers'

function criterionTooltip(criterion) {
  const parts = [criterion.label]
  if (criterion.notes) parts.push(criterion.notes)
  parts.push(`ID: ${criterion.id}`)
  return parts.join(' — ')
}

function CriterionRow({ criterion, points, maxPoints, editing, editedValue, onEdit, computed, evidence }) {
  const tone = criterionScoreClasses(points, maxPoints)

  return (
    <div className="py-1 px-2 hover:bg-white/15 transition-colors duration-150" title={criterionTooltip(criterion)}>
      <div className="flex items-center gap-2 min-h-[28px]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm leading-tight text-ink-primary">{criterion.label}</span>
        {computed && (
          <span
            className="shrink-0 rounded bg-surface-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted"
            title="Scored deterministically from response time, not LLM-judged"
          >
            auto
          </span>
        )}
        <div className="shrink-0">
          {editing ? (
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                min={0}
                max={maxPoints}
                value={editedValue ?? points}
                onChange={(e) => onEdit(clampCriterionScore(e.target.value, maxPoints))}
                className="w-11 rounded border border-border bg-surface px-1 py-0.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label={`${criterion.label} score`}
              />
              <span className="text-xs tabular-nums text-ink-muted">/{maxPoints}</span>
            </div>
          ) : (
            <span className={`inline-flex items-baseline gap-0.5 rounded px-1.5 py-0.5 text-sm font-bold tabular-nums ${tone.badge}`}>
              <span>{points}</span>
              <span className="text-xs font-normal text-ink-muted">/{maxPoints}</span>
            </span>
          )}
        </div>
      </div>
      {evidence && <p className="pl-3.5 pr-1 text-[11px] leading-snug text-ink-muted">{evidence}</p>}
    </div>
  )
}

function ScoreSection({ section, scores, editing, editedScores, onEditCriterion }) {
  const visible = section.criteria.filter((c) => Object.prototype.hasOwnProperty.call(scores, c.id))
  if (!visible.length) return null

  const activeScores = editing && editedScores && typeof editedScores === 'object' ? { ...scores, ...editedScores } : scores
  const { earned, max } = sectionScoreTotals(visible, activeScores)
  const sectionPct = max > 0 ? Math.round((earned / max) * 100) : 0
  const sectionTone = sectionScoreClasses(earned, max)

  return (
    <div className="glass-panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted/60 px-2 py-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-primary">{section.title}</h4>
        <span className={`text-xs font-bold tabular-nums ${sectionTone.header}`}>
          {earned}/{max}
          <span className="ml-1 font-medium text-ink-muted">({sectionPct}%)</span>
        </span>
      </div>
      <div className="divide-y divide-border/60 px-0.5 py-0.5">
        {visible.map((criterion) => {
          const raw = scores[criterion.id]
          const base = pointsOf(raw)
          const points = editing && editedScores != null && editedScores[criterion.id] != null ? pointsOf(editedScores[criterion.id]) : base
          return (
            <CriterionRow
              key={criterion.id}
              criterion={criterion}
              points={points}
              maxPoints={criterion.maxPoints || 0}
              editing={editing}
              editedValue={editedScores?.[criterion.id] != null ? pointsOf(editedScores[criterion.id]) : undefined}
              onEdit={(v) => onEditCriterion(criterion.id, v)}
              computed={isComputedCriterion(raw)}
              evidence={evidenceOf(raw)}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Section-grouped criterion scores: compact, scannable rows with semantic score chips and the
 * evidence the agent cited for each criterion.
 */
export default function ReviewQueueCriterionScores({ scores, scorecardStructure, editing = false, editedScores, onEditScores }) {
  const { sections } = buildCriterionMeta(scorecardStructure)
  const scoreMap = scores && typeof scores === 'object' ? scores : {}
  const hasScores = Object.keys(scoreMap).length > 0

  const handleEdit = (criterionId, value) => {
    if (!onEditScores) return
    onEditScores((prev) => ({ ...prev, [criterionId]: value }))
  }

  if (!hasScores) return <p className="text-sm text-ink-muted">No criterion scores.</p>

  const renderedSections = sections.map((section) => (
    <ScoreSection
      key={section.key}
      section={section}
      scores={scoreMap}
      editing={editing}
      editedScores={editedScores}
      onEditCriterion={handleEdit}
    />
  ))

  const knownIds = new Set(sections.flatMap((s) => s.criteria.map((c) => c.id)))
  const orphanEntries = Object.entries(scoreMap).filter(([id]) => !knownIds.has(id))

  return (
    <div className="space-y-2">
      {renderedSections}
      {orphanEntries.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface/80 px-2 py-1.5">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Other criteria</p>
          <div className="divide-y divide-border/40">
            {orphanEntries.map(([id, raw]) => {
              const pts = pointsOf(raw)
              const tone = criterionScoreClasses(pts, 10)
              return (
                <div key={id} className="flex items-center justify-between gap-2 px-2 py-1 text-sm" title={`ID: ${id}`}>
                  <span className="truncate text-ink-muted">{id}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-sm font-bold tabular-nums ${tone.badge}`}>{pts}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
