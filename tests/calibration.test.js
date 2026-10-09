import { describe, it, expect } from 'vitest'
import { aggregateCalibration, calibrationHints } from '../server/learningSignals.js'

describe('aggregateCalibration', () => {
  it('computes per-criterion mean delta (human - ai) and agreement', () => {
    const pairs = [
      { aiScores: { g2: 10, u3: 5 }, humanScores: { g2: 0, u3: 5 } }, // AI too generous on g2 by 10
      { aiScores: { g2: 10, u3: 4 }, humanScores: { g2: 0, u3: 5 } }, // g2 -10, u3 +1
    ]
    const cal = aggregateCalibration(pairs)
    const g2 = cal.perCriterion.find((c) => c.criterionId === 'g2')
    expect(g2.meanDelta).toBe(-10) // human scored lower, so the AI was too generous
    expect(g2.samples).toBe(2)
    expect(cal.sampleDrafts).toBe(2)
    expect(cal.criterionAgreementRate).toBeCloseTo(0.25, 2) // 1 of 4 criterion comparisons matched
  })

  it('handles structured (evidence) draft values', () => {
    const cal = aggregateCalibration([{ aiScores: { g2: { points: 10 } }, humanScores: { g2: 0 } }])
    expect(cal.perCriterion[0].meanDelta).toBe(-10)
  })

  it('calibrationHints surfaces the largest biases as readable lines', () => {
    const cal = aggregateCalibration([
      { aiScores: { g2: 10 }, humanScores: { g2: 0 } },
      { aiScores: { g2: 10 }, humanScores: { g2: 0 } },
    ])
    const hints = calibrationHints(cal)
    expect(hints[0]).toContain('g2')
    expect(hints[0]).toContain('too generous')
  })

  it('returns no hints when samples are too few or bias is small', () => {
    const cal = aggregateCalibration([{ aiScores: { u3: 5 }, humanScores: { u3: 3 } }])
    expect(calibrationHints(cal)).toEqual([]) // n=1 < minSamples
    const tiny = aggregateCalibration([
      { aiScores: { u3: 5 }, humanScores: { u3: 5 } },
      { aiScores: { u3: 5 }, humanScores: { u3: 5 } },
    ])
    expect(calibrationHints(tiny)).toEqual([])
  })
})
