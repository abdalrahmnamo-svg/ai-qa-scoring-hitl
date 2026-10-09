/**
 * Draft scores hold a structured value per criterion: `{ points, evidence, computed? }`.
 * A bare number is still read correctly (legacy / hand-edited data), but the guard rejects it on submit
 * because it carries no evidence. These helpers read points uniformly so totals, diffs and approval
 * stay shape-agnostic.
 */

/** @param {number | { points?: number } | null | undefined} v */
export function extractPoints(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object') return Number(v.points) || 0
  return Number(v) || 0
}

/** Sum points across a draftScores map (handles mixed number / structured shapes). */
export function sumDraftPoints(draftScores) {
  return Object.values(draftScores || {}).reduce((a, v) => a + extractPoints(v), 0)
}

/** Flatten a draftScores map to `{ criterionId: number }` (for scoreDiff / scores.scores). */
export function flattenDraftScores(draftScores) {
  const out = {}
  for (const [k, v] of Object.entries(draftScores || {})) out[k] = extractPoints(v)
  return out
}

/**
 * Review-queue triage. A draft is "high" priority when human judgment is most likely to change
 * the outcome: near the pass mark (borderline) or low agent confidence.
 * @returns {{ tier: 'high'|'normal', borderline: boolean, lowConfidence: boolean, weight: number }}
 */
export function reviewPriority(draft, { passThreshold = 90 } = {}) {
  const total = Number(draft?.totalScore) || 0
  const borderline = total >= passThreshold - 5 && total <= passThreshold + 4
  const lowConfidence = draft?.confidence != null && Number(draft.confidence) < 0.6
  const weight = (borderline ? 2 : 0) + (lowConfidence ? 2 : 0)
  return { tier: weight >= 2 ? 'high' : 'normal', borderline, lowConfidence, weight }
}
