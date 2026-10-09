/**
 * Deterministic criteria: scored from hard data, not LLM judgment.
 *
 * g2 ("first reply within target") is a formula, not an opinion: the effective response time vs the
 * target. Computing it server-side makes those points trustworthy by construction and removes a
 * whole class of AI-vs-human disagreement. The LLM's g2 value is overridden.
 *
 * effective response = adjustedResponseSec (already accounts for operating hours) ?? rawResponseSec.
 * When neither is present we cannot compute it, so the LLM value is left untouched.
 */

const DEFAULT_G2_MAX = 10
const DEFAULT_TARGET_FRT_MIN = 5

/** Find a criterion's maxPoints from a scorecard structure, or null. */
export function maxPointsFor(scorecardStructure, criterionId) {
  if (!scorecardStructure || typeof scorecardStructure !== 'object') return null
  for (const section of Object.values(scorecardStructure)) {
    for (const crit of section?.criteria || []) {
      if (crit?.id === criterionId) return Number(crit.maxPoints)
    }
  }
  return null
}

export function computeG2({ effectiveResponseSec, targetFrtSec, maxPoints }) {
  if (effectiveResponseSec == null || Number.isNaN(Number(effectiveResponseSec))) return null
  const sec = Number(effectiveResponseSec)
  const points = sec <= targetFrtSec ? maxPoints : 0
  return {
    points,
    computed: true,
    evidence: `Computed deterministically: effective response ${sec}s vs ${targetFrtSec}s target -> ${points}/${maxPoints}.`,
  }
}

/**
 * @param {object} args
 * @param {{ rawResponseSec?: number|null, adjustedResponseSec?: number|null }} args.conversation
 * @param {object} [args.scorecard] { scorecardStructure, operatingHours }
 * @returns {{ overrides: Record<string, object>, computed: string[] }}
 */
export function computeDeterministicCriteria({ conversation, scorecard } = {}) {
  const overrides = {}
  const computed = []
  if (!conversation) return { overrides, computed }

  const g2Max = maxPointsFor(scorecard?.scorecardStructure, 'g2') ?? DEFAULT_G2_MAX
  const targetMin = Number(scorecard?.operatingHours?.targetFrtMinutes) || DEFAULT_TARGET_FRT_MIN
  const effective = conversation.adjustedResponseSec ?? conversation.rawResponseSec ?? null

  const g2 = computeG2({ effectiveResponseSec: effective, targetFrtSec: targetMin * 60, maxPoints: g2Max })
  if (g2) {
    overrides.g2 = g2
    computed.push('g2')
  }
  return { overrides, computed }
}
