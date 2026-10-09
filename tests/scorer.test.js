import { describe, it, expect } from 'vitest'
import { openDb, loadScorecard, getConversation } from '../server/db.js'
import { seedDatabase } from '../server/seedData.js'
import { createScorer, mockScoreConversation } from '../server/scorer.js'
import { runGoldenEval } from '../server/goldenEval.js'
import { projectAgentConversation } from '../server/agentProjection.js'
import { validateDraftSubmission } from '../server/draftSubmitGuard.js'

function seeded(seed = 42) {
  const db = openDb(':memory:')
  seedDatabase(db, { seed })
  return db
}

describe('seed data', () => {
  it('is synthetic, deterministic and the expected size', () => {
    const a = seeded()
    const b = seeded()
    const dump = (db) => JSON.stringify(db.prepare('SELECT * FROM messages ORDER BY id').all())
    expect(dump(a)).toBe(dump(b))
    expect(a.prepare('SELECT COUNT(*) n FROM conversations').get().n).toBe(80)
    expect(a.prepare("SELECT COUNT(*) n FROM scores WHERE score_origin = 'golden'").get().n).toBe(20)
    const text = dump(a)
    expect(text).not.toMatch(/@(?!example\.com)[a-z0-9-]+\.[a-z]{2,}/i)
    expect(dump(seeded(7))).not.toBe(dump(a))
  })
})

describe('mock scorer', () => {
  it('is deterministic for a given seed and changes confidence jitter with another', () => {
    const db = seeded()
    const scorecard = loadScorecard(db)
    const conv = projectAgentConversation(getConversation(db, 'CONV-0001'))
    const a = mockScoreConversation({ conversation: conv, scorecard, seed: 's1' })
    const b = mockScoreConversation({ conversation: conv, scorecard, seed: 's1' })
    expect(a).toEqual(b)
    expect(a.draftScores).toEqual(mockScoreConversation({ conversation: conv, scorecard, seed: 's2' }).draftScores)
  })

  it('always produces drafts that pass the guard (after the g2 override)', () => {
    const db = seeded()
    const scorecard = loadScorecard(db)
    const ids = db.prepare("SELECT conversation_id id FROM conversations WHERE agent <> 'Unassigned'").all().map((r) => r.id)
    for (const id of ids) {
      const conv = projectAgentConversation(getConversation(db, id))
      const draft = mockScoreConversation({ conversation: conv, scorecard })
      const res = validateDraftSubmission(draft, scorecard.scorecardStructure)
      expect(res.errors, id).toEqual([])
    }
  })

  it('createScorer rejects unknown modes and claude without a key', async () => {
    expect(() => createScorer({ mode: 'nope' })).toThrow(/Unknown SCORER/)
    const claude = createScorer({ mode: 'claude', apiKey: '' })
    const prev = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    await expect(claude.score({ conversation: {}, scorecard: loadScorecard(seeded()) })).rejects.toThrow(/ANTHROPIC_API_KEY/)
    if (prev) process.env.ANTHROPIC_API_KEY = prev
  })
})

describe('golden-set eval', () => {
  it('produces a stable number on seed data and a sensible agreement level', async () => {
    const scorer = createScorer({ mode: 'mock' })
    const r1 = await runGoldenEval(seeded(), { scorer })
    const r2 = await runGoldenEval(seeded(), { scorer })
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    expect(r1.goldenConversations).toBe(20)
    expect(r1.withinToleranceRate).toBeGreaterThan(0.6)
    expect(r1.withinToleranceRate).toBeLessThan(1)
    expect(r1.criterionAgreementRate).toBeGreaterThan(0.85)
  })
})
