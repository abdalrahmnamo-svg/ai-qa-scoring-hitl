import { describe, it, expect } from 'vitest'
import { extractPoints, sumDraftPoints, flattenDraftScores, reviewPriority } from '../server/draftScoreHelpers.js'

describe('draftScoreHelpers', () => {
  it('extractPoints reads number, structured, and nullish values', () => {
    expect(extractPoints(5)).toBe(5)
    expect(extractPoints({ points: 4, evidence: 'x' })).toBe(4)
    expect(extractPoints(null)).toBe(0)
    expect(extractPoints({})).toBe(0)
  })

  it('sumDraftPoints handles mixed shapes', () => {
    expect(sumDraftPoints({ g1: 5, g2: { points: 10, computed: true }, u3: 3 })).toBe(18)
  })

  it('flattenDraftScores returns a numeric map', () => {
    expect(flattenDraftScores({ g1: 5, g2: { points: 0 } })).toEqual({ g1: 5, g2: 0 })
  })

  it('reviewPriority flags borderline totals as high', () => {
    expect(reviewPriority({ totalScore: 88 }).tier).toBe('high')
    expect(reviewPriority({ totalScore: 88 }).borderline).toBe(true)
    expect(reviewPriority({ totalScore: 100 }).tier).toBe('normal')
  })

  it('reviewPriority flags low confidence as high', () => {
    expect(reviewPriority({ totalScore: 100, confidence: 0.4 }).tier).toBe('high')
    expect(reviewPriority({ totalScore: 100, confidence: 0.9 }).tier).toBe('normal')
  })
})
