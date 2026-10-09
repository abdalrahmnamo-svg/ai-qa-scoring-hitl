/**
 * Draft lifecycle service.
 *
 *   submitDraft  (agent, service token)  -> row in draft_scores, status pending_human_review
 *   approveDraft (human)                 -> the ONLY code path that inserts into `scores`
 *   rejectDraft  (human, reason needed)  -> status rejected + reason; feeds learning signals
 */

import {
  transaction,
  loadScorecard,
  getConversation,
  mapDraftRow,
  mapScoreRow,
} from './db.js'
import { assertDraftSubmitAllowed, assertDraftValid } from './draftSubmitGuard.js'
import { computeDeterministicCriteria } from './deterministicCriteria.js'
import { sumDraftPoints, flattenDraftScores, reviewPriority } from './draftScoreHelpers.js'
import { buildCriterionList } from './scorecardShape.js'
import { findSimilarHumanScores } from './similarScored.js'
import { PASS_THRESHOLD } from '../src/utils/defaultScorecardConfig.js'

export class ReviewError extends Error {
  constructor(message, status = 400, code = 'review_error') {
    super(message)
    this.name = 'ReviewError'
    this.status = status
    this.code = code
  }
}

const nowIso = () => new Date().toISOString()

/**
 * Submit an AI draft. Order matters: block-guard, deterministic overrides, then validation.
 * @returns {object} the stored draft (always status 'pending_human_review')
 */
export function submitDraft(db, { conversationId, draftScores, reasoning, confidence, model }) {
  const id = String(conversationId || '').trim()
  if (!id) throw new ReviewError('conversationId is required', 400, 'bad_request')
  assertDraftSubmitAllowed(db, id)

  const scorecard = loadScorecard(db)
  const conversation = getConversation(db, id)

  // Deterministic criteria (g2) are computed server-side and override whatever the agent sent.
  const { overrides, computed } = computeDeterministicCriteria({ conversation, scorecard })
  const merged = draftScores && typeof draftScores === 'object' && !Array.isArray(draftScores)
    ? { ...draftScores, ...overrides }
    : draftScores

  assertDraftValid({ draftScores: merged, reasoning, confidence }, scorecard.scorecardStructure)

  const total = sumDraftPoints(merged)
  const info = db
    .prepare(
      `INSERT INTO draft_scores (conversation_id, draft_scores, total_score, passed, reasoning, confidence, model, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_human_review')`,
    )
    .run(id, JSON.stringify(merged), total, total >= PASS_THRESHOLD ? 1 : 0, reasoning.trim(), confidence ?? null, model ?? null)

  const draft = mapDraftRow(db.prepare('SELECT * FROM draft_scores WHERE id = ?').get(info.lastInsertRowid))
  return { ...draft, computedCriteria: computed }
}

/** Validate a reviewer's edited scores: integers within each criterion's range. Missing ids keep the draft value. */
function resolveFinalScores(draft, editedScores, scorecardStructure) {
  const base = flattenDraftScores(draft.draftScores)
  if (editedScores == null) return base
  if (typeof editedScores !== 'object' || Array.isArray(editedScores)) {
    throw new ReviewError('scores must be an object of criterionId -> integer', 422, 'invalid_scores')
  }
  const byId = new Map(buildCriterionList(scorecardStructure).map((c) => [c.id, c]))
  const out = { ...base }
  for (const [id, raw] of Object.entries(editedScores)) {
    const c = byId.get(id)
    if (!c) throw new ReviewError(`unknown criterion "${id}"`, 422, 'invalid_scores')
    const v = typeof raw === 'object' && raw ? raw.points : raw
    if (!Number.isInteger(v) || v < 0 || v > c.maxPoints) {
      throw new ReviewError(`criterion "${id}" must be an integer in 0..${c.maxPoints}`, 422, 'invalid_scores')
    }
    out[id] = v
  }
  return out
}

function getDraftOrThrow(db, id) {
  const draft = mapDraftRow(db.prepare('SELECT * FROM draft_scores WHERE id = ?').get(Number(id)))
  if (!draft) throw new ReviewError('Draft not found', 404, 'not_found')
  return draft
}

/**
 * Human approval. Creates the official `scores` row.
 * If the reviewer edited any criterion, the score is attributed to a human; otherwise it is an
 * AI score approved as-is ('agent_approved').
 */
export function approveDraft(db, id, { reviewer = 'reviewer', comments, scores, reviewNote } = {}) {
  const scorecard = loadScorecard(db)
  return transaction(db, () => {
    const draft = getDraftOrThrow(db, id)
    if (draft.status !== 'pending_human_review') {
      throw new ReviewError(`Draft is ${draft.status}; only pending drafts can be approved`, 409, 'not_pending')
    }
    const blocked = db.prepare('SELECT 1 FROM scores WHERE conversation_id = ?').get(draft.conversationId)
    if (blocked) throw new ReviewError('Conversation already has an official score', 409, 'already_scored')

    const finalScores = resolveFinalScores(draft, scores, scorecard.scorecardStructure)
    const total = Object.values(finalScores).reduce((a, b) => a + b, 0)
    const edited = JSON.stringify(finalScores) !== JSON.stringify(flattenDraftScores(draft.draftScores))
    const ts = nowIso()

    db.prepare(
      `UPDATE draft_scores SET status = 'approved', final_scores = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
    ).run(JSON.stringify(finalScores), reviewNote?.trim() || null, reviewer, ts, draft.id)

    db.prepare(
      `INSERT INTO scores (conversation_id, scores, total_score, passed, score_origin, comments, scored_by, scored_date, approved_draft_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      draft.conversationId,
      JSON.stringify(finalScores),
      total,
      total >= PASS_THRESHOLD ? 1 : 0,
      edited ? 'human' : 'agent_approved',
      comments?.trim() || null,
      reviewer,
      ts,
      draft.id,
    )
    return {
      draft: getDraftOrThrow(db, draft.id),
      score: mapScoreRow(db.prepare('SELECT * FROM scores WHERE conversation_id = ?').get(draft.conversationId)),
      edited,
    }
  })
}

/** Human rejection. A reason is mandatory: it is the learning signal. Never creates a score. */
export function rejectDraft(db, id, { reviewer = 'reviewer', reason } = {}) {
  const note = String(reason || '').trim()
  if (!note) throw new ReviewError('A rejection reason is required', 422, 'reason_required')
  return transaction(db, () => {
    const draft = getDraftOrThrow(db, id)
    if (draft.status !== 'pending_human_review') {
      throw new ReviewError(`Draft is ${draft.status}; only pending drafts can be rejected`, 409, 'not_pending')
    }
    db.prepare(`UPDATE draft_scores SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).run(
      note,
      reviewer,
      nowIso(),
      draft.id,
    )
    return { draft: getDraftOrThrow(db, draft.id) }
  })
}

/** Drafts for the review UI, enriched with transcript, priority and similar human scores. */
export function listDrafts(db, { status = 'pending_human_review', limit = 200 } = {}) {
  const rows =
    status === 'all'
      ? db.prepare('SELECT * FROM draft_scores ORDER BY id DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM draft_scores WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)

  const drafts = rows.map(mapDraftRow).map((d) => {
    const conv = getConversation(db, d.conversationId)
    const scoreRow = db.prepare('SELECT * FROM scores WHERE conversation_id = ?').get(d.conversationId)
    const approvedScore = d.status === 'approved' ? mapScoreRow(scoreRow) : null
    return {
      ...d,
      // Reviewers see the full (unredacted) transcript; only the scoring agent gets the redacted projection.
      conversation: conv
        ? { conversationId: conv.conversationId, agent: conv.agent, contact: conv.contact, date: conv.date, messages: conv.messages }
        : null,
      reviewPriority: reviewPriority(d, { passThreshold: PASS_THRESHOLD }),
      similarHumanScores: d.status === 'pending_human_review' ? findSimilarHumanScores(db, d.conversationId) : [],
      approvedScore,
    }
  })
  // High-priority first (borderline / low confidence), then newest.
  return drafts.sort((a, b) => b.reviewPriority.weight - a.reviewPriority.weight || b.id - a.id)
}
