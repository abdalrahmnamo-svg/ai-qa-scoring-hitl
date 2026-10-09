import { describe, it, expect } from 'vitest'
import { scoreDiff, inferPrimaryTopic, isHumanAuthoredScore, CRITERION_TOPIC } from '../server/learningSignals.js'

describe('learningSignals', () => {
  it('scoreDiff finds criterion changes', () => {
    const diffs = scoreDiff({ g1: 5, g2: 10 }, { g1: 3, g2: 10 })
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ criterionId: 'g1', aiPoints: 5, humanPoints: 3, topic: 'greeting' })
  })

  it('inferPrimaryTopic picks dominant section', () => {
    expect(inferPrimaryTopic({ g1: 5, g2: 10, g3: 5 })).toBe('greeting')
    expect(inferPrimaryTopic({ u1: 5, u2: 5 })).toBe('understanding')
  })

  it('isHumanAuthoredScore excludes AI-approved scores', () => {
    expect(isHumanAuthoredScore({ comments: 'Good handling' })).toBe(true)
    expect(isHumanAuthoredScore({ scoreOrigin: 'agent_approved' })).toBe(false)
    expect(isHumanAuthoredScore({ scoreOrigin: 'human' })).toBe(true)
    expect(isHumanAuthoredScore({ scoreOrigin: 'golden' })).toBe(true)
  })

  it('CRITERION_TOPIC covers all scorecard ids', () => {
    const ids = ['g1', 'g2', 'g3', 'u1', 'u2', 'u3', 'u4', 'r1', 'r2', 'r3', 'c1', 'c2', 'c3', 't1', 't2', 't3', 'p1', 'p2']
    for (const id of ids) expect(CRITERION_TOPIC[id]).toBeTruthy()
  })
})
