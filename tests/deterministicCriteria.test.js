import { describe, it, expect } from 'vitest'
import { computeG2, computeDeterministicCriteria, maxPointsFor } from '../server/deterministicCriteria.js'
import { DEFAULT_SCORECARD_STRUCTURE } from '../src/utils/defaultScorecardConfig.js'

const scorecard = { scorecardStructure: DEFAULT_SCORECARD_STRUCTURE, operatingHours: { targetFrtMinutes: 5 } }

describe('deterministicCriteria', () => {
  it('maxPointsFor finds g2 = 10 in the default rubric', () => {
    expect(maxPointsFor(DEFAULT_SCORECARD_STRUCTURE, 'g2')).toBe(10)
    expect(maxPointsFor(DEFAULT_SCORECARD_STRUCTURE, 'nope')).toBeNull()
  })

  it('computeG2 awards full points within target and zero past it', () => {
    expect(computeG2({ effectiveResponseSec: 120, targetFrtSec: 300, maxPoints: 10 }).points).toBe(10)
    expect(computeG2({ effectiveResponseSec: 301, targetFrtSec: 300, maxPoints: 10 }).points).toBe(0)
    expect(computeG2({ effectiveResponseSec: null, targetFrtSec: 300, maxPoints: 10 })).toBeNull()
  })

  it('prefers adjustedResponseSec over rawResponseSec', () => {
    const { overrides, computed } = computeDeterministicCriteria({
      conversation: { rawResponseSec: 600, adjustedResponseSec: 120 },
      scorecard,
    })
    expect(computed).toContain('g2')
    expect(overrides.g2.points).toBe(10) // adjusted (120s) is within target, raw (600s) ignored
    expect(overrides.g2.computed).toBe(true)
  })

  it('returns no overrides when response time is unknown', () => {
    const { overrides, computed } = computeDeterministicCriteria({
      conversation: { rawResponseSec: null, adjustedResponseSec: null },
      scorecard,
    })
    expect(computed).toHaveLength(0)
    expect(overrides.g2).toBeUndefined()
  })
})
