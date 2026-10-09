/**
 * Learning loop. Human rejections and edit-corrections on AI drafts are the ground truth that the
 * next scoring batch reads back (via `fetch_learning_signals`). Nothing here is stored separately:
 * signals are derived from `draft_scores` (status, review_note, final_scores) so they can never drift
 * from the review history.
 */

import { extractPoints } from './draftScoreHelpers.js'
import { topicMap } from './scorecardShape.js'
import { DEFAULT_SCORECARD_STRUCTURE } from '../src/utils/defaultScorecardConfig.js'
import { mapDraftRow } from './db.js'

/** criterion id -> scorecard section key, for the default scorecard. */
export const CRITERION_TOPIC = topicMap(DEFAULT_SCORECARD_STRUCTURE)

export function scoreDiff(aiScores, humanScores) {
  const ids = new Set([...Object.keys(aiScores || {}), ...Object.keys(humanScores || {})])
  const diffs = []
  for (const criterionId of ids) {
    const ai = extractPoints(aiScores?.[criterionId])
    const human = extractPoints(humanScores?.[criterionId])
    if (ai !== human) {
      diffs.push({ criterionId, topic: CRITERION_TOPIC[criterionId] || 'general', aiPoints: ai, humanPoints: human })
    }
  }
  return diffs
}

/**
 * Calibration: how the agent's drafts compare to human scores, per criterion, over a set of
 * {aiScores, humanScores} pairs.
 * meanDelta = mean(human - ai): positive means the agent is too harsh; negative means too generous.
 */
export function aggregateCalibration(pairs) {
  const byCrit = {}
  let totalCompared = 0
  let agreements = 0
  for (const { aiScores, humanScores } of pairs || []) {
    const ids = new Set([...Object.keys(aiScores || {}), ...Object.keys(humanScores || {})])
    for (const id of ids) {
      const ai = extractPoints(aiScores?.[id])
      const human = extractPoints(humanScores?.[id])
      const b = byCrit[id] || (byCrit[id] = { criterionId: id, topic: CRITERION_TOPIC[id] || 'general', n: 0, sumDelta: 0, sumAbs: 0 })
      b.n++
      b.sumDelta += human - ai
      b.sumAbs += Math.abs(human - ai)
      totalCompared++
      if (ai === human) agreements++
    }
  }
  const perCriterion = Object.values(byCrit)
    .map((b) => ({
      criterionId: b.criterionId,
      topic: b.topic,
      samples: b.n,
      meanDelta: Number((b.sumDelta / b.n).toFixed(2)),
      meanAbsError: Number((b.sumAbs / b.n).toFixed(2)),
    }))
    .sort((a, b) => Math.abs(b.meanDelta) - Math.abs(a.meanDelta) || a.criterionId.localeCompare(b.criterionId))
  return {
    sampleDrafts: (pairs || []).length,
    criterionAgreementRate: totalCompared ? Number((agreements / totalCompared).toFixed(3)) : null,
    perCriterion,
  }
}

/** One-line bias hints the agent can read before its next session (top |meanDelta| criteria). */
export function calibrationHints(calibration, { limit = 5, minSamples = 2 } = {}) {
  return (calibration?.perCriterion || [])
    .filter((c) => c.samples >= minSamples && Math.abs(c.meanDelta) >= 0.5)
    .slice(0, limit)
    .map((c) => `${c.criterionId}: you run ${c.meanDelta > 0 ? 'too harsh' : 'too generous'} by ${Math.abs(c.meanDelta)} pts on avg (n=${c.samples}).`)
}

export function inferPrimaryTopic(draftScores) {
  if (!draftScores || typeof draftScores !== 'object') return 'general'
  const topics = Object.keys(draftScores).map((id) => CRITERION_TOPIC[id] || 'general')
  const counts = {}
  for (const t of topics) counts[t] = (counts[t] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'general'
}

/** A score counts as a human calibration example if a person authored it (not a pure AI approval). */
export function isHumanAuthoredScore(score) {
  if (!score) return false
  if (score.scoreOrigin === 'agent_approved') return false
  if (score.scoreOrigin === 'human' || score.scoreOrigin === 'golden') return true
  const comments = String(score?.comments || '')
  return !comments.includes('AI-drafted')
}

/**
 * Derive learning signals from review history.
 * @returns {{ rejections: object[], corrections: object[], calibration: object, biasHints: string[] }}
 */
export function fetchLearningSignals(db, { sinceDays = 30, limit = 50, now = Date.now() } = {}) {
  const since = new Date(now - sinceDays * 86400000).toISOString()

  const rejectedRows = db
    .prepare(
      `SELECT * FROM draft_scores WHERE status = 'rejected' AND reviewed_at >= ? ORDER BY reviewed_at DESC, id DESC LIMIT ?`,
    )
    .all(since, limit)
  const rejections = rejectedRows.map(mapDraftRow).map((d) => ({
    draftId: d.id,
    conversationId: d.conversationId,
    aiTotal: d.totalScore,
    reason: d.reviewNote,
    topic: inferPrimaryTopic(d.draftScores),
    reviewedAt: d.reviewedAt,
  }))

  // Calibration uses every approved draft (not only the window): more samples, steadier hints.
  const approved = db
    .prepare(`SELECT * FROM draft_scores WHERE status = 'approved' AND final_scores IS NOT NULL ORDER BY reviewed_at DESC, id DESC`)
    .all()
    .map(mapDraftRow)
  const pairs = approved.map((d) => ({ aiScores: d.draftScores, humanScores: d.finalScores }))
  const calibration = aggregateCalibration(pairs)

  const corrections = approved
    .filter((d) => d.reviewedAt >= since)
    .map((d) => ({
      draftId: d.id,
      conversationId: d.conversationId,
      note: d.reviewNote,
      diffs: scoreDiff(d.draftScores, d.finalScores),
      reviewedAt: d.reviewedAt,
    }))
    .filter((c) => c.diffs.length > 0)
    .slice(0, limit)

  return { sinceDays, rejections, corrections, calibration, biasHints: calibrationHints(calibration) }
}
