/**
 * Guardrails around draft submission.
 *
 * 1. Block guard: no new pending draft on a conversation that already has an official score, an
 *    approved draft, or a pending draft.
 * 2. Validation guard: a draft must be well-formed, in range, and carry evidence for every criterion.
 *
 * Neither guard can create a score. Only the human approve path (server/drafts.js) writes `scores`.
 */

import { buildCriterionList } from './scorecardShape.js'

export const DRAFT_SUBMIT_BLOCK = {
  ALREADY_SCORED: 'already_scored',
  CONVERSATION_ALREADY_APPROVED: 'conversation_already_approved',
  PENDING_EXISTS: 'pending_draft_exists',
  UNKNOWN_CONVERSATION: 'unknown_conversation',
}

const BLOCK_MESSAGES = {
  [DRAFT_SUBMIT_BLOCK.ALREADY_SCORED]: 'Conversation already has an official score; cannot create a new pending draft.',
  [DRAFT_SUBMIT_BLOCK.CONVERSATION_ALREADY_APPROVED]: 'Conversation already has an approved draft; cannot create a new pending draft.',
  [DRAFT_SUBMIT_BLOCK.PENDING_EXISTS]: 'Conversation already has a draft awaiting review.',
  [DRAFT_SUBMIT_BLOCK.UNKNOWN_CONVERSATION]: 'Unknown conversation.',
}

export class DraftSubmitBlockedError extends Error {
  /** @param {{ code: string, conversationId: string, score?: object, approvedDraftId?: number, pendingDraftId?: number }} block */
  constructor(block) {
    super(BLOCK_MESSAGES[block.code] || 'Draft submission blocked.')
    this.name = 'DraftSubmitBlockedError'
    this.code = block.code
    this.conversationId = block.conversationId
    this.status = block.code === DRAFT_SUBMIT_BLOCK.UNKNOWN_CONVERSATION ? 404 : 409
    this.details = block
  }
}

export class DraftValidationError extends Error {
  /** @param {{ code: string, criterionId?: string, message: string }[]} errors */
  constructor(errors) {
    super(`Draft rejected by guard: ${errors.map((e) => e.message).join('; ')}`)
    this.name = 'DraftValidationError'
    this.code = 'draft_invalid'
    this.status = 422
    this.errors = errors
  }
}

/** SQL predicate (alias `c` = conversations): conversations that must not receive new pending drafts are excluded. */
export const EXCLUDE_ALREADY_SCORED_SQL = `
  NOT EXISTS (SELECT 1 FROM scores s WHERE s.conversation_id = c.conversation_id)
  AND NOT EXISTS (SELECT 1 FROM draft_scores d WHERE d.conversation_id = c.conversation_id AND d.status = 'approved')`

/** @returns {{ code: string, conversationId: string, ... } | null} */
export function getDraftSubmitBlock(db, conversationId) {
  const conv = db.prepare('SELECT conversation_id FROM conversations WHERE conversation_id = ?').get(conversationId)
  if (!conv) return { code: DRAFT_SUBMIT_BLOCK.UNKNOWN_CONVERSATION, conversationId }

  const scoreRow = db
    .prepare('SELECT conversation_id, score_origin, total_score FROM scores WHERE conversation_id = ?')
    .get(conversationId)
  if (scoreRow) {
    return {
      code: DRAFT_SUBMIT_BLOCK.ALREADY_SCORED,
      conversationId,
      score: { conversationId, scoreOrigin: scoreRow.score_origin, totalScore: scoreRow.total_score },
    }
  }
  const approved = db
    .prepare("SELECT id FROM draft_scores WHERE conversation_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1")
    .get(conversationId)
  if (approved) {
    return { code: DRAFT_SUBMIT_BLOCK.CONVERSATION_ALREADY_APPROVED, conversationId, approvedDraftId: approved.id }
  }
  const pending = db
    .prepare("SELECT id FROM draft_scores WHERE conversation_id = ? AND status = 'pending_human_review' LIMIT 1")
    .get(conversationId)
  if (pending) {
    return { code: DRAFT_SUBMIT_BLOCK.PENDING_EXISTS, conversationId, pendingDraftId: pending.id }
  }
  return null
}

export function assertDraftSubmitAllowed(db, conversationId) {
  const block = getDraftSubmitBlock(db, conversationId)
  if (block) throw new DraftSubmitBlockedError(block)
}

/** @returns {Set<string>} conversationIds that must not get new pending drafts (scored or approved) */
export function loadBlockedConversationIdSet(db, conversationIds) {
  if (!conversationIds.length) return new Set()
  const unique = [...new Set(conversationIds)]
  const marks = unique.map(() => '?').join(',')
  const scored = db.prepare(`SELECT conversation_id FROM scores WHERE conversation_id IN (${marks})`).all(...unique)
  const approved = db
    .prepare(`SELECT conversation_id FROM draft_scores WHERE status = 'approved' AND conversation_id IN (${marks})`)
    .all(...unique)
  return new Set([...scored, ...approved].map((r) => r.conversation_id))
}

/**
 * Supersede pending drafts on conversations that already have a score or approved draft.
 * @returns {{ pendingTotal: number, superseded: number, conversationIds: string[], draftIds: number[] }}
 */
export function supersedeStrayPendingDrafts(db, { dryRun = false } = {}) {
  const pending = db
    .prepare("SELECT id, conversation_id FROM draft_scores WHERE status = 'pending_human_review'")
    .all()
  const blocked = loadBlockedConversationIdSet(db, pending.map((p) => p.conversation_id))
  const stray = pending.filter((p) => blocked.has(p.conversation_id))
  if (!dryRun && stray.length) {
    const upd = db.prepare("UPDATE draft_scores SET status = 'superseded' WHERE id = ?")
    for (const s of stray) upd.run(s.id)
  }
  return {
    pendingTotal: pending.length,
    superseded: stray.length,
    conversationIds: [...new Set(stray.map((s) => s.conversation_id))],
    draftIds: stray.map((s) => s.id),
  }
}

const MIN_EVIDENCE_CHARS = 12

/**
 * Validate a draft against the live scorecard. Returns every problem found, not just the first.
 * @param {{ draftScores?: any, reasoning?: any, confidence?: any }} draft
 * @param {object} scorecardStructure
 * @returns {{ ok: boolean, errors: { code: string, criterionId?: string, message: string }[] }}
 */
export function validateDraftSubmission(draft, scorecardStructure) {
  const errors = []
  const criteria = buildCriterionList(scorecardStructure)
  const byId = new Map(criteria.map((c) => [c.id, c]))
  const scores = draft?.draftScores

  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    errors.push({ code: 'malformed', message: 'draftScores must be an object keyed by criterion id' })
    return { ok: false, errors }
  }

  for (const id of Object.keys(scores)) {
    if (!byId.has(id)) errors.push({ code: 'unknown_criterion', criterionId: id, message: `unknown criterion "${id}"` })
  }

  for (const c of criteria) {
    const v = scores[c.id]
    if (v == null) {
      errors.push({ code: 'missing_criterion', criterionId: c.id, message: `criterion "${c.id}" is missing` })
      continue
    }
    if (typeof v !== 'object' || Array.isArray(v)) {
      errors.push({
        code: 'missing_evidence',
        criterionId: c.id,
        message: `criterion "${c.id}" must be { points, evidence }; bare values carry no evidence`,
      })
      continue
    }
    const pts = v.points
    if (!Number.isInteger(pts)) {
      errors.push({ code: 'malformed', criterionId: c.id, message: `criterion "${c.id}" points must be an integer` })
    } else if (pts < 0 || pts > c.maxPoints) {
      errors.push({
        code: 'out_of_range',
        criterionId: c.id,
        message: `criterion "${c.id}" points ${pts} outside 0..${c.maxPoints}`,
      })
    }
    if (!v.computed) {
      const ev = typeof v.evidence === 'string' ? v.evidence.trim() : ''
      if (ev.length < MIN_EVIDENCE_CHARS) {
        errors.push({
          code: 'missing_evidence',
          criterionId: c.id,
          message: `criterion "${c.id}" needs evidence (at least ${MIN_EVIDENCE_CHARS} characters quoting or citing the transcript)`,
        })
      }
    }
  }

  if (typeof draft?.reasoning !== 'string' || !draft.reasoning.trim()) {
    errors.push({ code: 'missing_reasoning', message: 'reasoning is required' })
  }
  if (draft?.confidence != null && !(typeof draft.confidence === 'number' && draft.confidence >= 0 && draft.confidence <= 1)) {
    errors.push({ code: 'malformed', message: 'confidence must be a number between 0 and 1' })
  }
  return { ok: errors.length === 0, errors }
}

export function assertDraftValid(draft, scorecardStructure) {
  const { ok, errors } = validateDraftSubmission(draft, scorecardStructure)
  if (!ok) throw new DraftValidationError(errors)
}
