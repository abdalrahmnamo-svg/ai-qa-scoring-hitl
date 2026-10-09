import { describe, test, expect } from 'vitest'
import {
  buildCriterionMeta,
  clampCriterionScore,
  criterionScoreTone,
  scoreDiff,
  sectionScoreTotals,
  sumCriterionScores,
  buildPerfectScores,
  draftLikeFromScores,
  verdictClasses,
  kpiToneClasses,
  suggestApproveComments,
} from '../src/utils/draftReviewHelpers.js'
import { DEFAULT_SCORECARD_STRUCTURE } from '../src/utils/defaultScorecardConfig.js'

describe('draftReviewHelpers scorecard meta', () => {
  test('buildCriterionMeta maps ids to maxPoints', () => {
    const { byId, sections } = buildCriterionMeta(DEFAULT_SCORECARD_STRUCTURE)
    expect(byId.g2.maxPoints).toBe(10)
    expect(byId.r1.maxPoints).toBe(6)
    expect(sections).toHaveLength(6)
    expect(sections[0].criteria[0].id).toBeTruthy()
  })

  test('buildCriterionMeta preserves canonical section order regardless of JSON key order', () => {
    const s = DEFAULT_SCORECARD_STRUCTURE
    const shuffled = {
      process: s.process,
      courtesy: s.courtesy,
      confirmation: s.confirmation,
      greeting: s.greeting,
      understanding: s.understanding,
      resolution: s.resolution,
    }
    const { sections } = buildCriterionMeta(shuffled)
    expect(sections.map((x) => x.key)).toEqual(['greeting', 'understanding', 'resolution', 'confirmation', 'courtesy', 'process'])
  })

  test('clampCriterionScore respects max', () => {
    expect(clampCriterionScore(99, 10)).toBe(10)
    expect(clampCriterionScore(-3, 5)).toBe(0)
    expect(clampCriterionScore('4', 5)).toBe(4)
  })

  test('scoreDiff finds criterion changes with topic', () => {
    const diffs = scoreDiff({ g1: 5, g2: 10 }, { g1: 3, g2: 10 })
    expect(diffs).toEqual([{ criterionId: 'g1', topic: 'greeting', aiPoints: 5, humanPoints: 3 }])
  })

  test('criterionScoreTone uses percentage thresholds', () => {
    expect(criterionScoreTone(5, 5)).toBe('full')
    expect(criterionScoreTone(10, 10)).toBe('full')
    expect(criterionScoreTone(0, 10)).toBe('critical')
    expect(criterionScoreTone(8, 10)).toBe('good')
    expect(criterionScoreTone(5, 10)).toBe('warning')
    expect(criterionScoreTone(3, 5)).toBe('warning')
    expect(criterionScoreTone(2, 10)).toBe('critical')
  })

  test('sectionScoreTotals sums visible criteria only', () => {
    const criteria = [
      { id: 'g1', maxPoints: 5 },
      { id: 'g2', maxPoints: 10 },
    ]
    expect(sectionScoreTotals(criteria, { g1: 5, g2: 0 })).toEqual({ earned: 5, max: 15 })
  })

  test('sumCriterionScores matches server draft-approve total', () => {
    expect(sumCriterionScores({ g1: 5, g2: 0, u1: 5 })).toBe(10)
    expect(sumCriterionScores(null)).toBe(0)
  })

  test('buildPerfectScores sets each criterion to maxPoints', () => {
    const perfect = buildPerfectScores(DEFAULT_SCORECARD_STRUCTURE)
    expect(perfect.g1).toBe(5)
    expect(perfect.g2).toBe(10)
    expect(sumCriterionScores(perfect)).toBe(100)
  })

  test('draftLikeFromScores derives pass from total', () => {
    expect(draftLikeFromScores({ g1: 5 }, 95).passed).toBe(true)
    expect(draftLikeFromScores({ g2: 0 }, 70).passed).toBe(false)
  })

  test('verdictClasses at PASS_THRESHOLD', () => {
    expect(verdictClasses(90).passed).toBe(true)
    expect(verdictClasses(89).passed).toBe(false)
    expect(verdictClasses(90).kpi).toContain('kpi-verdict-pass')
    expect(verdictClasses(50).kpi).toContain('kpi-verdict-fail')
  })

  test('kpiToneClasses vs target', () => {
    expect(kpiToneClasses(92, 90)).toBe('text-score-full')
    expect(kpiToneClasses(70, 90)).toBe('text-score-critical')
  })

  test('suggestApproveComments tailors failing feedback', () => {
    expect(suggestApproveComments({ totalScore: 99 })).toContain('Perfect')
    const c = suggestApproveComments({ totalScore: 60, draftScores: { g2: 0, u3: 2, c2: 5, r2: 10, r3: 5 } })
    expect(c).toContain('5 minutes')
    expect(c).toContain('empathetic')
  })
})
