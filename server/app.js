/**
 * HTTP API (Hono). Two route groups with different trust levels:
 *
 *   /api/agent/*   service-token (Bearer QA_MCP_TOKEN). Read data, submit DRAFTS. Cannot approve.
 *   /api/review/*  the human review UI. Rejects requests carrying the service token (403), so the
 *                  agent credential can never be used to approve or reject.
 *
 * The demo has no user login; put the review routes behind your own auth before exposing them.
 */

import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { loadScorecard, getConversation, hydrateConversation } from './db.js'
import { PASS_THRESHOLD } from '../src/utils/defaultScorecardConfig.js'
import { submitDraft, approveDraft, rejectDraft, listDrafts, ReviewError } from './drafts.js'
import { DraftSubmitBlockedError, DraftValidationError, EXCLUDE_ALREADY_SCORED_SQL } from './draftSubmitGuard.js'
import { buildDailyScoringBatch, isGradableConversation } from './dailyScoringBatch.js'
import { fetchLearningSignals } from './learningSignals.js'
import { findScoredExamples } from './similarScored.js'
import { projectAgentConversation } from './agentProjection.js'

function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function bearerOf(c) {
  const h = c.req.header('authorization') || ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ serviceToken?: string }} [opts]
 */
export function createApp(db, { serviceToken = process.env.QA_MCP_TOKEN } = {}) {
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof DraftSubmitBlockedError) {
      return c.json({ error: err.message, code: err.code, details: err.details }, err.status)
    }
    if (err instanceof DraftValidationError) {
      return c.json({ error: err.message, code: err.code, errors: err.errors }, err.status)
    }
    if (err instanceof ReviewError) {
      return c.json({ error: err.message, code: err.code }, err.status)
    }
    console.error('[api] unhandled error:', err)
    return c.json({ error: 'Internal error' }, 500)
  })

  app.get('/health', (c) => c.json({ ok: true }))

  // ---- agent routes (service token) -------------------------------------------------------
  const agent = new Hono()
  agent.use('*', async (c, next) => {
    const token = bearerOf(c)
    if (!serviceToken || !token || !safeEqual(token, serviceToken)) {
      return c.json({ error: 'Unauthorized: missing or invalid service token', code: 'unauthorized' }, 401)
    }
    await next()
  })

  agent.get('/scorecard', (c) => c.json(loadScorecard(db)))

  agent.get('/unscored', (c) => {
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 10))
    const { agent: agentName, from, to } = c.req.query()
    const rows = db
      .prepare(
        `SELECT c.* FROM conversations c
          WHERE ${EXCLUDE_ALREADY_SCORED_SQL}
            AND NOT EXISTS (SELECT 1 FROM draft_scores p WHERE p.conversation_id = c.conversation_id AND p.status = 'pending_human_review')
            AND (? IS NULL OR c.agent = ?) AND (? IS NULL OR c.date >= ?) AND (? IS NULL OR c.date <= ?)
          ORDER BY c.date DESC, c.conversation_id DESC`,
      )
      .all(agentName ?? null, agentName ?? null, from ?? null, from ?? null, to ?? null, to ?? null)
      .map((r) => hydrateConversation(db, r))
      .filter(isGradableConversation)
      .slice(0, limit)
      .map(projectAgentConversation)
    return c.json({ conversations: rows })
  })

  agent.get('/daily-batch', (c) => {
    const date = c.req.query('date') || db.prepare('SELECT MAX(date) AS d FROM conversations').get().d
    const perAgent = Math.min(10, Math.max(1, Number(c.req.query('perAgent')) || 2))
    return c.json(buildDailyScoringBatch(db, { dateStr: date, perAgent, seed: process.env.BATCH_SEED || 'qa-demo' }))
  })

  agent.get('/scored-examples', (c) => {
    const limit = Math.min(30, Math.max(1, Number(c.req.query('limit')) || 10))
    const examples = findScoredExamples(db, { agent: c.req.query('agent') || undefined, limit }).map((ex) => ({
      ...ex,
      messages: projectAgentConversation({ ...ex, messagesRaw: ex.messages }).messages,
    }))
    return c.json({ examples })
  })

  agent.get('/learning-signals', (c) => {
    const sinceDays = Math.min(365, Math.max(1, Number(c.req.query('sinceDays')) || 30))
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50))
    return c.json(fetchLearningSignals(db, { sinceDays, limit }))
  })

  agent.post('/drafts', async (c) => {
    let body
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Body must be JSON', code: 'bad_request' }, 400)
    }
    const draft = submitDraft(db, {
      conversationId: body.conversationId,
      draftScores: body.draftScores,
      reasoning: body.reasoning,
      confidence: body.confidence,
      model: body.model,
    })
    return c.json(
      {
        draftId: draft.id,
        status: draft.status,
        totalScore: draft.totalScore,
        passed: draft.passed,
        computedCriteria: draft.computedCriteria,
      },
      201,
    )
  })

  app.route('/api/agent', agent)

  // ---- review routes (human UI) -----------------------------------------------------------
  const review = new Hono()
  review.use('*', async (c, next) => {
    const token = bearerOf(c)
    if (token && serviceToken && safeEqual(token, serviceToken)) {
      return c.json({ error: 'The agent service token cannot be used for review actions', code: 'forbidden' }, 403)
    }
    await next()
  })

  review.get('/config', (c) => c.json({ ...loadScorecard(db), passThreshold: PASS_THRESHOLD }))

  review.get('/drafts', (c) => {
    const status = c.req.query('status') || 'pending_human_review'
    return c.json({ drafts: listDrafts(db, { status }) })
  })

  review.get('/conversations/:id', (c) => {
    const conv = getConversation(db, c.req.param('id'))
    return conv ? c.json(conv) : c.json({ error: 'Not found' }, 404)
  })

  review.post('/drafts/:id/approve', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const result = approveDraft(db, c.req.param('id'), {
      reviewer: body.reviewer || 'reviewer',
      comments: body.comments,
      scores: body.scores,
      reviewNote: body.reviewNote,
    })
    return c.json(result)
  })

  review.post('/drafts/:id/reject', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const result = rejectDraft(db, c.req.param('id'), { reviewer: body.reviewer || 'reviewer', reason: body.reason })
    return c.json(result)
  })

  app.route('/api/review', review)
  return app
}
