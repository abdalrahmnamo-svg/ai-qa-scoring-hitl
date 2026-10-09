/**
 * Golden-set evaluation: how closely do AI drafts match human judgment?
 *
 * The golden set is the conversations whose official score has origin 'golden' (human scores written
 * by the seed script and held out from every example the agent can fetch). For each one we:
 *   1. ask the scorer for a draft (the same call the batch makes), with NO reviewer feedback applied,
 *   2. apply the server-side deterministic override for g2,
 *   3. compare the draft with the human score.
 *
 * Metrics (all over the golden set):
 *   withinToleranceRate    share where |AI total - human total| <= tolerance (default 5 points)  <- headline
 *   passFailAgreementRate  share where AI and human land on the same side of the pass mark (90)
 *   criterionAgreementRate share of individual criterion comparisons with identical points
 *   meanAbsTotalError      mean |AI total - human total|
 *
 * The report holds no timestamps, so with the mock scorer it is identical run to run.
 */
import { loadScorecard, getConversation, mapScoreRow } from './db.js'
import { computeDeterministicCriteria } from './deterministicCriteria.js'
import { sumDraftPoints, flattenDraftScores } from './draftScoreHelpers.js'
import { aggregateCalibration, calibrationHints } from './learningSignals.js'
import { projectAgentConversation } from './agentProjection.js'
import { PASS_THRESHOLD } from '../src/utils/defaultScorecardConfig.js'

export async function runGoldenEval(db, { scorer, tolerance = 5 }) {
  const scorecard = loadScorecard(db)
  const goldenRows = db.prepare("SELECT * FROM scores WHERE score_origin = 'golden' ORDER BY conversation_id").all().map(mapScoreRow)
  if (!goldenRows.length) throw new Error('No golden scores found. Run `npm run seed` first.')

  const items = []
  const pairs = []
  let within = 0
  let sameVerdict = 0
  let absErr = 0
  for (const gold of goldenRows) {
    const conv = getConversation(db, gold.conversationId)
    const draft = await scorer.score({ conversation: projectAgentConversation(conv), scorecard, signals: null })
    const { overrides } = computeDeterministicCriteria({ conversation: conv, scorecard })
    const ai = { ...draft.draftScores, ...overrides }
    const aiTotal = sumDraftPoints(ai)
    const delta = gold.totalScore - aiTotal
    const ok = Math.abs(delta) <= tolerance
    if (ok) within++
    if (aiTotal >= PASS_THRESHOLD === gold.totalScore >= PASS_THRESHOLD) sameVerdict++
    absErr += Math.abs(delta)
    pairs.push({ aiScores: flattenDraftScores(ai), humanScores: gold.scores })
    items.push({ conversationId: gold.conversationId, aiTotal, humanTotal: gold.totalScore, totalDelta: delta, withinTolerance: ok })
  }

  const n = goldenRows.length
  const calibration = aggregateCalibration(pairs)
  const rate = (x) => Number((x / n).toFixed(3))

  // Informational: drafts a reviewer already approved (varies with usage, unlike the golden set).
  const approved = db.prepare("SELECT draft_scores, final_scores FROM draft_scores WHERE status = 'approved'").all()
  const asIs = approved.filter((r) => JSON.stringify(flattenDraftScores(JSON.parse(r.draft_scores))) === r.final_scores).length

  return {
    scorer: `${scorer.mode} (${scorer.model})`,
    goldenConversations: n,
    tolerancePoints: tolerance,
    headline: `${within}/${n} drafts within +/-${tolerance} points of the human score (${(rate(within) * 100).toFixed(1)}%)`,
    withinToleranceRate: rate(within),
    passFailAgreementRate: rate(sameVerdict),
    criterionAgreementRate: calibration.criterionAgreementRate,
    meanAbsTotalError: Number((absErr / n).toFixed(2)),
    biasHints: calibrationHints(calibration, { minSamples: 5 }),
    perCriterion: calibration.perCriterion,
    reviewConfirmed: { approvedDrafts: approved.length, approvedAsIs: asIs },
    items,
  }
}
