import { describe, it, expect, beforeEach } from 'vitest'
import {
  DRAFT_SUBMIT_BLOCK,
  DraftSubmitBlockedError,
  getDraftSubmitBlock,
  assertDraftSubmitAllowed,
  loadBlockedConversationIdSet,
  supersedeStrayPendingDrafts,
  validateDraftSubmission,
  EXCLUDE_ALREADY_SCORED_SQL,
} from '../server/draftSubmitGuard.js'
import { openDb } from '../server/db.js'
import { seedDatabase } from '../server/seedData.js'
import { DEFAULT_SCORECARD_STRUCTURE } from '../src/utils/defaultScorecardConfig.js'
import { buildCriterionList } from '../server/scorecardShape.js'

function makeDb() {
  const db = openDb(':memory:')
  seedDatabase(db, { seed: 42 })
  return db
}

const unscoredId = (db) =>
  db
    .prepare(`SELECT c.conversation_id AS id FROM conversations c WHERE c.agent <> 'Unassigned' AND ${EXCLUDE_ALREADY_SCORED_SQL} ORDER BY c.conversation_id LIMIT 1`)
    .get().id

function insertDraft(db, conversationId, status) {
  return db
    .prepare(
      `INSERT INTO draft_scores (conversation_id, draft_scores, total_score, passed, reasoning, status) VALUES (?, '{}', 50, 0, 'r', ?)`,
    )
    .run(conversationId, status).lastInsertRowid
}

describe('draftSubmitGuard: block rules', () => {
  let db
  beforeEach(() => {
    db = makeDb()
  })

  it('allows draft submit when no score, approved draft or pending draft exists', () => {
    const id = unscoredId(db)
    expect(getDraftSubmitBlock(db, id)).toBeNull()
    expect(() => assertDraftSubmitAllowed(db, id)).not.toThrow()
  })

  it('blocks when the conversation has an official score', () => {
    const id = db.prepare('SELECT conversation_id AS id FROM scores LIMIT 1').get().id
    expect(getDraftSubmitBlock(db, id)?.code).toBe(DRAFT_SUBMIT_BLOCK.ALREADY_SCORED)
    expect(() => assertDraftSubmitAllowed(db, id)).toThrow(DraftSubmitBlockedError)
  })

  it('blocks when the conversation has an approved draft (no score row)', () => {
    const id = unscoredId(db)
    insertDraft(db, id, 'approved')
    expect(getDraftSubmitBlock(db, id)?.code).toBe(DRAFT_SUBMIT_BLOCK.CONVERSATION_ALREADY_APPROVED)
  })

  it('blocks a second pending draft', () => {
    const id = unscoredId(db)
    insertDraft(db, id, 'pending_human_review')
    expect(getDraftSubmitBlock(db, id)?.code).toBe(DRAFT_SUBMIT_BLOCK.PENDING_EXISTS)
  })

  it('reports unknown conversations', () => {
    expect(getDraftSubmitBlock(db, 'CONV-9999')?.code).toBe(DRAFT_SUBMIT_BLOCK.UNKNOWN_CONVERSATION)
  })

  it('loadBlockedConversationIdSet unions scored and approved-draft ids', () => {
    const scored = db.prepare('SELECT conversation_id AS id FROM scores LIMIT 1').get().id
    const free = unscoredId(db)
    insertDraft(db, free, 'approved')
    const blocked = loadBlockedConversationIdSet(db, [scored, free, 'CONV-0000'])
    expect([...blocked].sort()).toEqual([scored, free].sort())
  })

  it('supersedeStrayPendingDrafts supersedes pending drafts on blocked conversations only', () => {
    const scored = db.prepare('SELECT conversation_id AS id FROM scores LIMIT 1').get().id
    const free = unscoredId(db)
    insertDraft(db, scored, 'pending_human_review')
    const keep = insertDraft(db, free, 'pending_human_review')
    const dry = supersedeStrayPendingDrafts(db, { dryRun: true })
    expect(dry.superseded).toBe(1)
    const res = supersedeStrayPendingDrafts(db)
    expect(res.conversationIds).toEqual([scored])
    expect(db.prepare('SELECT status FROM draft_scores WHERE id = ?').get(keep).status).toBe('pending_human_review')
  })
})

describe('draftSubmitGuard: validation', () => {
  const criteria = buildCriterionList(DEFAULT_SCORECARD_STRUCTURE)
  const good = () =>
    Object.fromEntries(criteria.map((c) => [c.id, { points: c.maxPoints, evidence: `Agent wrote something relevant for ${c.id}` }]))
  const check = (over) => validateDraftSubmission({ reasoning: 'ok reasoning', ...over }, DEFAULT_SCORECARD_STRUCTURE)
  const codes = (r) => r.errors.map((e) => e.code)

  it('accepts a complete, in-range draft with evidence', () => {
    expect(check({ draftScores: good() }).ok).toBe(true)
  })

  it('rejects a malformed draftScores container', () => {
    expect(codes(check({ draftScores: null }))).toContain('malformed')
    expect(codes(check({ draftScores: [1, 2] }))).toContain('malformed')
  })

  it('rejects missing and unknown criteria', () => {
    const s = good()
    delete s.u1
    s.zz = { points: 1, evidence: 'not a real criterion at all' }
    const r = check({ draftScores: s })
    expect(codes(r)).toEqual(expect.arrayContaining(['missing_criterion', 'unknown_criterion']))
  })

  it('rejects out-of-range and non-integer points', () => {
    const s = good()
    s.g1 = { points: 99, evidence: 'Agent wrote something relevant' }
    s.u1 = { points: -1, evidence: 'Agent wrote something relevant' }
    s.u2 = { points: 2.5, evidence: 'Agent wrote something relevant' }
    const r = check({ draftScores: s })
    expect(codes(r).filter((c) => c === 'out_of_range')).toHaveLength(2)
    expect(codes(r)).toContain('malformed')
  })

  it('rejects bare numbers and thin evidence (missing evidence)', () => {
    const s = good()
    s.g1 = 5
    s.u1 = { points: 5, evidence: 'ok' }
    s.u2 = { points: 5 }
    const r = check({ draftScores: s })
    expect(codes(r).filter((c) => c === 'missing_evidence')).toHaveLength(3)
  })

  it('allows computed criteria without agent evidence text', () => {
    const s = good()
    s.g2 = { points: 10, computed: true }
    expect(check({ draftScores: s }).ok).toBe(true)
  })

  it('requires reasoning and a sane confidence', () => {
    expect(codes(validateDraftSubmission({ draftScores: good(), reasoning: ' ' }, DEFAULT_SCORECARD_STRUCTURE))).toContain('missing_reasoning')
    expect(codes(check({ draftScores: good(), confidence: 1.5 }))).toContain('malformed')
  })
})
