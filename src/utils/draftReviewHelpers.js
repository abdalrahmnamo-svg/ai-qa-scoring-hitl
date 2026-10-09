import { PASS_THRESHOLD, orderedScorecardSections } from './defaultScorecardConfig.js'

/**
 * A draftScores value is `{ points, evidence, computed? }` (per-criterion evidence, server-computed g2).
 * A bare number is still read correctly so older rows and hand-edited maps keep working.
 */
export function pointsOf(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object') return Number(v.points) || 0
  return Number(v) || 0
}

export function evidenceOf(v) {
  return v && typeof v === 'object' && typeof v.evidence === 'string' ? v.evidence : null
}

export function isComputedCriterion(v) {
  return Boolean(v && typeof v === 'object' && v.computed)
}

/** Reviewer comment templates. */
export const PASS_COMMENT_TEMPLATES = [
  '- Perfect! Keep it up!',
  '- Good job! Keep it up!',
  '- Well done, great handling of this inquiry.',
]

export const FAIL_COMMENT_TEMPLATES = [
  '- Make sure to reply within the first 5 minutes of receiving a chat.',
  '- Make sure to be more empathetic and avoid short answers throughout the chat.',
  "- Ensure the customer's need is fully resolved before closing; follow up where needed.",
  '- Review messages before sending (grammar, spelling, clarity).',
]

/**
 * Suggest a reviewer comment for approve, based on the draft outcome.
 * @param {{ totalScore?: number, passed?: boolean, draftScores?: Record<string, number> }} draft
 */
export function suggestApproveComments(draft) {
  const total = draft?.totalScore ?? 0
  const passed = draft?.passed ?? total >= PASS_THRESHOLD
  const scores = draft?.draftScores || {}

  if (passed && total >= 98) return PASS_COMMENT_TEMPLATES[0]
  if (passed) return PASS_COMMENT_TEMPLATES[1]

  const parts = []
  if (pointsOf(scores.g2 ?? 10) < 10) {
    parts.push('- Make sure to reply within the first 5 minutes of receiving a chat.')
  }
  if (pointsOf(scores.u3 ?? 5) < 5) {
    parts.push('- Make sure to be more empathetic and avoid short answers throughout the chat.')
  }
  if (pointsOf(scores.c2 ?? 5) < 5 || pointsOf(scores.r2 ?? 10) < 8) {
    parts.push("- Ensure the customer's need is fully met before closing the chat.")
  }
  if (pointsOf(scores.r3 ?? 5) < 5) {
    parts.push('- Review messages before sending (grammar, spelling, clarity).')
  }

  if (parts.length) return parts.join('\n')
  return FAIL_COMMENT_TEMPLATES[FAIL_COMMENT_TEMPLATES.length - 1]
}

/** Criterion map with every id set to maxPoints (full marks). */
export function buildPerfectScores(scorecardStructure) {
  const perfect = {}
  const { sections } = buildCriterionMeta(scorecardStructure)
  for (const section of sections) {
    for (const c of section.criteria) perfect[c.id] = c.maxPoints ?? 0
  }
  return perfect
}

/** Draft-like object for comment suggestions from live criterion edits. */
export function draftLikeFromScores(scores, totalScore) {
  const total = totalScore ?? sumCriterionScores(scores)
  return { draftScores: scores, totalScore: total, passed: isPassingTotal(total) }
}

/** Criterion id -> scorecard section key, derived from the live structure. */
export function topicByCriterion(scorecardStructure) {
  const map = {}
  for (const [key, section] of orderedScorecardSections(scorecardStructure)) {
    for (const c of section?.criteria || []) if (c?.id) map[c.id] = key
  }
  return map
}

const DEFAULT_TOPICS = {
  g1: 'greeting', g2: 'greeting', g3: 'greeting',
  u1: 'understanding', u2: 'understanding', u3: 'understanding', u4: 'understanding',
  r1: 'resolution', r2: 'resolution', r3: 'resolution',
  c1: 'confirmation', c2: 'confirmation', c3: 'confirmation',
  t1: 'courtesy', t2: 'courtesy', t3: 'courtesy',
  p1: 'process', p2: 'process',
}

/** Per-criterion diffs between AI draft and human-final scores (mirrors server/learningSignals.js). */
export function scoreDiff(aiScores, humanScores) {
  const ids = new Set([...Object.keys(aiScores || {}), ...Object.keys(humanScores || {})])
  const diffs = []
  for (const criterionId of ids) {
    const ai = pointsOf(aiScores?.[criterionId])
    const human = pointsOf(humanScores?.[criterionId])
    if (ai !== human) {
      diffs.push({ criterionId, topic: DEFAULT_TOPICS[criterionId] || 'general', aiPoints: ai, humanPoints: human })
    }
  }
  return diffs
}

/**
 * Scorecard structure -> lookup map + ordered sections for the Review Queue UI.
 * @param {object | null} scorecardStructure
 */
export function buildCriterionMeta(scorecardStructure) {
  const byId = {}
  const sections = []
  if (!scorecardStructure || typeof scorecardStructure !== 'object') return { byId, sections }
  for (const [key, section] of orderedScorecardSections(scorecardStructure)) {
    const criteria = (section?.criteria || [])
      .filter((c) => c?.id)
      .map((c) => ({ id: c.id, label: c.label || c.id, maxPoints: Number(c.maxPoints) || 0, notes: c.notes || '' }))
    sections.push({ key, title: section?.title || key, criteria })
    for (const c of criteria) byId[c.id] = c
  }
  return { byId, sections }
}

/** Clamp a draft edit to [0, maxPoints]. */
export function clampCriterionScore(value, maxPoints) {
  const max = Math.max(0, Number(maxPoints) || 0)
  const n = parseInt(value, 10)
  const parsed = Number.isFinite(n) ? n : 0
  return Math.max(0, Math.min(max, parsed))
}

/**
 * Visual tone bucket from awarded / max ratio.
 * full >= 100%, good >= 80%, warning >= 50%, critical < 50% or zero.
 */
export function criterionScoreTone(points, maxPoints) {
  const max = Number(maxPoints) || 0
  const pts = Number(points) || 0
  if (max <= 0) return 'neutral'
  if (pts <= 0) return 'critical'
  const ratio = pts / max
  if (ratio >= 1) return 'full'
  if (ratio >= 0.8) return 'good'
  if (ratio >= 0.5) return 'warning'
  return 'critical'
}

const SCORE_TONE_CLASSES = {
  full: { text: 'text-score-full', dot: 'bg-score-full', bar: 'bg-score-full', badge: 'bg-score-full/20 text-score-full', header: 'text-score-full' },
  good: { text: 'text-score-good', dot: 'bg-score-good', bar: 'bg-score-good', badge: 'bg-score-good/20 text-score-good', header: 'text-score-good' },
  warning: { text: 'text-score-warn', dot: 'bg-score-warn', bar: 'bg-score-warn', badge: 'bg-score-warn/20 text-score-warn', header: 'text-score-warn' },
  critical: { text: 'text-score-critical', dot: 'bg-score-critical', bar: 'bg-score-critical', badge: 'bg-score-critical/20 text-score-critical', header: 'text-score-critical' },
  neutral: { text: 'text-ink-muted', dot: 'bg-steel', bar: 'bg-steel', badge: 'bg-surface-muted text-ink-muted', header: 'text-ink-muted' },
}

export function criterionScoreClasses(points, maxPoints) {
  return SCORE_TONE_CLASSES[criterionScoreTone(points, maxPoints)]
}

/** Section subtotal tone: same thresholds as criterion rows. */
export function sectionScoreClasses(earned, max) {
  return criterionScoreClasses(earned, max)
}

/** Sum awarded / max for criteria in a section that appear in scores. */
export function sectionScoreTotals(criteria, scores) {
  let earned = 0
  let max = 0
  for (const c of criteria) {
    if (!Object.prototype.hasOwnProperty.call(scores, c.id)) continue
    const m = c.maxPoints || 0
    max += m
    earned += Math.min(m, Math.max(0, pointsOf(scores[c.id])))
  }
  return { earned, max }
}

/** Total /100 from a criterion map; matches the server's approve arithmetic. */
export function sumCriterionScores(scores) {
  if (!scores || typeof scores !== 'object') return 0
  return Object.values(scores).reduce((sum, v) => sum + pointsOf(v), 0)
}

/** Pass/fail at PASS_THRESHOLD (default 90). */
export function isPassingTotal(totalScore, threshold = PASS_THRESHOLD) {
  return Number(totalScore) >= threshold
}

/** Unified verdict styling for total /100 KPIs. */
export function verdictClasses(totalScore, threshold = PASS_THRESHOLD) {
  const passed = isPassingTotal(totalScore, threshold)
  return {
    passed,
    kpi: passed ? 'kpi-verdict kpi-verdict-pass' : 'kpi-verdict kpi-verdict-fail',
    text: passed ? 'text-success' : 'text-error',
    badge: passed ? 'badge-pass' : 'badge-fail',
    scoreText: passed ? 'text-score-full' : 'text-score-critical',
  }
}

/** KPI tone from value vs target (for example average score vs 90). */
export function kpiToneClasses(value, target, higherIsBetter = true) {
  const v = Number(value) || 0
  const t = Number(target) || 0
  if (higherIsBetter) {
    if (v >= t) return 'text-score-full'
    if (v >= t * 0.8) return 'text-score-warn'
    return 'text-score-critical'
  }
  if (v <= t) return 'text-score-full'
  if (v <= t * 1.2) return 'text-score-warn'
  return 'text-score-critical'
}
