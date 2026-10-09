import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../server/db.js'
import { seedDatabase } from '../server/seedData.js'
import { createApp } from '../server/app.js'
import { createHandlers } from '../qa-mcp/handlers.js'
import { createScorer } from '../server/scorer.js'
import { runBatch, inProcessFetch } from '../server/agentRunner.js'
import { fetchLearningSignals } from '../server/learningSignals.js'
import { redactText } from '../server/redact.js'

const TOKEN = 'test-token'
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function setup() {
  const db = openDb(':memory:')
  seedDatabase(db, { seed: 42 })
  const app = createApp(db, { serviceToken: TOKEN })
  const handlers = createHandlers({ apiUrl: 'http://local', token: TOKEN, fetchImpl: inProcessFetch(app) })
  const result = await runBatch({ handlers, scorer: createScorer({ mode: 'mock' }), date: '2025-03-07', perAgent: 1 })
  return { db, app, handlers, result }
}

const scoreCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM scores').get().n

describe('human-in-the-loop gate', () => {
  let ctx
  beforeEach(async () => {
    ctx = await setup()
  })

  it('a draft never becomes a score without approve', () => {
    const { db, result } = ctx
    expect(result.submitted.length).toBeGreaterThan(0)
    const before = scoreCount(db)
    const pending = db.prepare("SELECT conversation_id FROM draft_scores WHERE status = 'pending_human_review'").all()
    expect(pending).toHaveLength(result.submitted.length)
    for (const p of pending) {
      expect(db.prepare('SELECT 1 FROM scores WHERE conversation_id = ?').get(p.conversation_id)).toBeUndefined()
    }
    expect(scoreCount(db)).toBe(before)
  })

  it('the agent service token cannot approve or reject (403) and the unauthenticated UI route works', async () => {
    const { app, result } = ctx
    const id = result.submitted[0].draftId
    const asAgent = await app.request(`/api/review/drafts/${id}/approve`, {
      ...json({}),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    })
    expect(asAgent.status).toBe(403)
    const rejectAsAgent = await app.request(`/api/review/drafts/${id}/reject`, {
      ...json({ reason: 'x' }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    })
    expect(rejectAsAgent.status).toBe(403)
  })

  it('approve creates exactly one official score; as-is is agent_approved, edited is human', async () => {
    const { app, db, result } = ctx
    const [a, b] = result.submitted
    const res = await app.request(`/api/review/drafts/${a.draftId}/approve`, json({ reviewer: 'Reviewer 01', comments: 'ok' }))
    expect(res.status).toBe(200)
    const asIs = await res.json()
    expect(asIs.edited).toBe(false)
    expect(asIs.score.scoreOrigin).toBe('agent_approved')
    expect(scoreCount(db)).toBe(28 + 1)

    const draft = db.prepare('SELECT draft_scores FROM draft_scores WHERE id = ?').get(b.draftId)
    const u3 = JSON.parse(draft.draft_scores).u3.points
    const edited = await app.request(
      `/api/review/drafts/${b.draftId}/approve`,
      json({ scores: { u3: u3 > 0 ? u3 - 1 : 1 }, reviewNote: 'empathy was thin' }),
    )
    const body = await edited.json()
    expect(body.edited).toBe(true)
    expect(body.score.scoreOrigin).toBe('human')
    expect(scoreCount(db)).toBe(28 + 2)
  })

  it('re-seeding after reviews have happened still works (foreign keys respected)', async () => {
    const { db, app, result } = ctx
    await app.request(`/api/review/drafts/${result.submitted[0].draftId}/approve`, json({}))
    expect(() => seedDatabase(db, { seed: 42 })).not.toThrow()
    expect(scoreCount(db)).toBe(28)
    expect(db.prepare('SELECT COUNT(*) AS n FROM draft_scores').get().n).toBe(0)
  })

  it('approve rejects out-of-range edits and non-pending drafts', async () => {
    const { app, result } = ctx
    const id = result.submitted[0].draftId
    const bad = await app.request(`/api/review/drafts/${id}/approve`, json({ scores: { g1: 999 } }))
    expect(bad.status).toBe(422)
    const ok = await app.request(`/api/review/drafts/${id}/approve`, json({}))
    expect(ok.status).toBe(200)
    const again = await app.request(`/api/review/drafts/${id}/approve`, json({}))
    expect(again.status).toBe(409)
  })

  it('reject requires a reason, records it, creates no score, and shows up as a learning signal', async () => {
    const { app, db, result } = ctx
    const { draftId, conversationId } = result.submitted[0]
    const before = scoreCount(db)

    const noReason = await app.request(`/api/review/drafts/${draftId}/reject`, json({ reason: '   ' }))
    expect(noReason.status).toBe(422)
    expect(db.prepare('SELECT status FROM draft_scores WHERE id = ?').get(draftId).status).toBe('pending_human_review')

    const res = await app.request(`/api/review/drafts/${draftId}/reject`, json({ reviewer: 'Reviewer 01', reason: 'Empathy score too generous' }))
    expect(res.status).toBe(200)
    const row = db.prepare('SELECT status, review_note, reviewed_by FROM draft_scores WHERE id = ?').get(draftId)
    expect(row).toMatchObject({ status: 'rejected', review_note: 'Empathy score too generous', reviewed_by: 'Reviewer 01' })
    expect(scoreCount(db)).toBe(before)

    const signals = fetchLearningSignals(db)
    expect(signals.rejections).toHaveLength(1)
    expect(signals.rejections[0]).toMatchObject({ draftId, conversationId, reason: 'Empathy score too generous' })

    // The next agent session sees it through the MCP tool.
    const viaTool = await ctx.handlers.fetch_learning_signals({})
    expect(viaTool.rejections[0].reason).toBe('Empathy score too generous')
  })

  it('reviewer corrections become calibration that changes the next batch', async () => {
    const { app, db, handlers, result } = ctx
    // Reviewer repeatedly lowers u3 (empathy) by 2 before approving.
    for (const s of result.submitted.slice(0, 4)) {
      const draft = JSON.parse(db.prepare('SELECT draft_scores FROM draft_scores WHERE id = ?').get(s.draftId).draft_scores)
      await app.request(`/api/review/drafts/${s.draftId}/approve`, json({ scores: { u3: Math.max(0, draft.u3.points - 2) } }))
    }
    const signals = await handlers.fetch_learning_signals({})
    expect(signals.corrections.length).toBeGreaterThan(0)
    const u3 = signals.calibration.perCriterion.find((c) => c.criterionId === 'u3')
    expect(u3.meanDelta).toBeLessThan(0)
    expect(signals.biasHints.join(' ')).toContain('u3')

    const scorer = createScorer({ mode: 'mock' })
    const scorecard = await handlers.fetch_scorecard_config()
    const conv = (await handlers.fetch_unscored_conversations({ limit: 1 }))[0]
    const plain = await scorer.score({ conversation: conv, scorecard, signals: null })
    const calibrated = await scorer.score({ conversation: conv, scorecard, signals })
    expect(calibrated.draftScores.u3.points).toBeLessThanOrEqual(plain.draftScores.u3.points)
  })

  it('the guard stops evidence-free drafts and double submissions at the API', async () => {
    const { app, handlers, result } = ctx
    const next = (await handlers.fetch_unscored_conversations({ limit: 1 }))[0]
    const scorecard = await handlers.fetch_scorecard_config()
    const ids = Object.values(scorecard.scorecardStructure).flatMap((s) => s.criteria.map((c) => c.id))

    const bare = Object.fromEntries(ids.map((id) => [id, 1]))
    await expect(handlers.submit_draft_score({ conversationId: next.conversationId, draftScores: bare, reasoning: 'x' })).rejects.toMatchObject({ status: 422 })

    // Already-pending conversation -> 409
    await expect(
      handlers.submit_draft_score({ conversationId: result.submitted[0].conversationId, draftScores: bare, reasoning: 'x' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('g2 is overridden server-side whatever the agent sends', async () => {
    const { db, handlers } = ctx
    const next = (await handlers.fetch_unscored_conversations({ limit: 1 }))[0]
    const scorecard = await handlers.fetch_scorecard_config()
    const scored = await createScorer({ mode: 'mock' }).score({ conversation: next, scorecard, signals: null })
    scored.draftScores.g2 = { points: 3, evidence: 'agent guess that should be overridden' }
    const out = await handlers.submit_draft_score({ conversationId: next.conversationId, ...scored })
    expect(out.computedCriteria).toContain('g2')
    const stored = JSON.parse(db.prepare('SELECT draft_scores FROM draft_scores WHERE id = ?').get(out.draftId).draft_scores)
    expect(stored.g2.computed).toBe(true)
    expect([0, 10]).toContain(stored.g2.points)
  })
})

describe('redaction', () => {
  it('masks emails and phone numbers', () => {
    expect(redactText('mail customer0042@example.com or call +1-555-0142 now')).toBe('mail [email] or call [phone] now')
  })
})
