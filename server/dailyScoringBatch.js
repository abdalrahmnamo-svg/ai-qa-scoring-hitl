/**
 * Daily scoring batch selection: up to `perAgent` random unscored, gradable conversations per agent
 * for a given day. Randomness is seeded so a batch is reproducible.
 */

import { hydrateConversation } from './db.js'
import { projectAgentConversation } from './agentProjection.js'
import { EXCLUDE_ALREADY_SCORED_SQL } from './draftSubmitGuard.js'

/** Small seeded PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit string hash (FNV-1a) used to derive seeds. */
export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** System boilerplate, not gradable agent performance. */
export const NON_GRADABLE_AGENT_TEXT =
  /^(Start|End) Conversation|Thank you for chatting with us|If you'd like to rate your conversation|Please type the word "Rate"/i

/**
 * A conversation is gradable as agent performance only if a human agent actually engaged.
 * Bot-only / unassigned flows (menu navigation, auto-routing) are not agent work.
 */
export function hasHumanAgentTurn(messagesRaw) {
  return (Array.isArray(messagesRaw) ? messagesRaw : []).some((m) => {
    if (m.sender !== 'agent' || m.isBot) return false
    const text = String(m.text || '').trim()
    if (!text || NON_GRADABLE_AGENT_TEXT.test(text)) return false
    return true
  })
}

export function isGradableConversation(row) {
  if (!row?.agent || row.agent === 'Unassigned') return false
  return hasHumanAgentTurn(row.messagesRaw)
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ dateStr: string, perAgent?: number, seed?: number|string }} opts
 */
export function buildDailyScoringBatch(db, { dateStr, perAgent = 2, seed = 'qa-demo' }) {
  const rng = mulberry32(hashString(`${seed}:${dateStr}`))

  const agents = db
    .prepare("SELECT DISTINCT agent FROM conversations WHERE date = ? AND agent <> 'Unassigned' ORDER BY agent")
    .all(dateStr)
    .map((r) => r.agent)

  const pendingSet = new Set(
    db
      .prepare("SELECT conversation_id FROM draft_scores WHERE status = 'pending_human_review'")
      .all()
      .map((r) => r.conversation_id),
  )

  const batch = []
  for (const agent of agents) {
    const rows = db
      .prepare(
        `SELECT c.* FROM conversations c
          WHERE c.date = ? AND c.agent = ? AND ${EXCLUDE_ALREADY_SCORED_SQL}
          ORDER BY c.conversation_id`,
      )
      .all(dateStr, agent)
    const eligible = rows
      .filter((r) => !pendingSet.has(r.conversation_id))
      .map((r) => hydrateConversation(db, r))
      .filter(isGradableConversation)

    shuffleInPlace(eligible, rng)
    const picked = eligible.slice(0, perAgent)
    batch.push({ agent, eligible: eligible.length, conversations: picked.map(projectAgentConversation) })
  }

  const totalConversations = batch.reduce((n, b) => n + b.conversations.length, 0)
  return { date: dateStr, perAgent, agentCount: agents.length, totalConversations, agents: batch }
}
