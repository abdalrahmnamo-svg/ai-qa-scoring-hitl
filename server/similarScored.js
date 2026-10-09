/** Human-scored calibration examples (shown to the reviewer and fetched by the agent). */

import { hydrateConversation, mapScoreRow } from './db.js'
import { isHumanAuthoredScore } from './learningSignals.js'

/**
 * Human-authored scores, newest first. `golden` rows are held out on purpose: they are the blind
 * evaluation set and must never be shown to the agent as examples.
 */
export function findHumanScores(db, { agent, limit = 10, excludeConversationId } = {}) {
  const rows = db
    .prepare(
      `SELECT c.*, s.scores, s.total_score, s.passed, s.score_origin, s.comments, s.scored_by, s.scored_date, s.approved_draft_id
         FROM scores s JOIN conversations c ON c.conversation_id = s.conversation_id
        WHERE (? IS NULL OR c.agent = ?)
        ORDER BY c.date DESC, c.conversation_id DESC`,
    )
    .all(agent ?? null, agent ?? null)

  const out = []
  for (const r of rows) {
    if (r.score_origin === 'golden') continue
    const score = mapScoreRow({ ...r, conversation_id: r.conversation_id })
    if (!isHumanAuthoredScore(score)) continue
    if (excludeConversationId && r.conversation_id === excludeConversationId) continue
    out.push({
      conversationId: r.conversation_id,
      agent: r.agent,
      date: r.date,
      totalScore: score.totalScore,
      passed: score.passed,
      comments: score.comments || '',
      scoredBy: score.scoredBy || '',
      scores: score.scores,
    })
    if (out.length >= limit) break
  }
  return out
}

/** Same as findHumanScores but with the (redacted-by-caller) transcript attached. */
export function findScoredExamples(db, opts = {}) {
  return findHumanScores(db, opts).map((ex) => {
    const row = db.prepare('SELECT * FROM conversations WHERE conversation_id = ?').get(ex.conversationId)
    const conv = hydrateConversation(db, row)
    return { ...ex, messages: conv.messages }
  })
}

export function findSimilarHumanScores(db, conversationId, { limit = 3 } = {}) {
  const conv = db.prepare('SELECT agent FROM conversations WHERE conversation_id = ?').get(conversationId)
  if (!conv?.agent) return []
  return findHumanScores(db, { agent: conv.agent, limit, excludeConversationId: conversationId })
}
