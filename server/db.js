/**
 * SQLite access via the built-in `node:sqlite` module (no ORM, plain SQL migrations).
 * `process.getBuiltinModule` keeps bundlers/test runners from trying to resolve the specifier.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SCORECARD_STRUCTURE,
  DEFAULT_MASTER_GUIDELINES,
  DEFAULT_OPERATING_HOURS,
} from '../src/utils/defaultScorecardConfig.js'

const { DatabaseSync } = process.getBuiltinModule('node:sqlite')

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(here, '..', 'db', 'migrations')

export const DEFAULT_DB_PATH = path.join(here, '..', 'data', 'qa.db')

export function resolveDbPath() {
  return process.env.QA_DB_PATH || DEFAULT_DB_PATH
}

/** Open (and migrate) a database. Pass ':memory:' for tests. */
export function openDb(dbPath = resolveDbPath()) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  ensureScorecardConfig(db)
  return db
}

export function migrate(db) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

export function ensureScorecardConfig(db) {
  const row = db.prepare('SELECT id FROM scorecard_config WHERE id = 1').get()
  if (row) return
  db.prepare('INSERT INTO scorecard_config (id, structure, guidelines, operating_hours) VALUES (1, ?, ?, ?)').run(
    JSON.stringify(DEFAULT_SCORECARD_STRUCTURE),
    JSON.stringify(DEFAULT_MASTER_GUIDELINES),
    JSON.stringify(DEFAULT_OPERATING_HOURS),
  )
}

/** Run `fn` inside BEGIN/COMMIT; roll back on throw. */
export function transaction(db, fn) {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function loadScorecard(db) {
  const row = db.prepare('SELECT * FROM scorecard_config WHERE id = 1').get()
  if (!row) {
    return {
      scorecardStructure: DEFAULT_SCORECARD_STRUCTURE,
      guidelines: DEFAULT_MASTER_GUIDELINES,
      operatingHours: DEFAULT_OPERATING_HOURS,
    }
  }
  return {
    scorecardStructure: JSON.parse(row.structure),
    guidelines: JSON.parse(row.guidelines),
    operatingHours: JSON.parse(row.operating_hours),
  }
}

export function getConversation(db, conversationId) {
  const row = db.prepare('SELECT * FROM conversations WHERE conversation_id = ?').get(conversationId)
  if (!row) return null
  return hydrateConversation(db, row)
}

export function hydrateConversation(db, row) {
  const messages = db
    .prepare('SELECT sender, is_bot, text, ts FROM messages WHERE conversation_id = ? ORDER BY seq')
    .all(row.conversation_id)
    .map((m) => ({ sender: m.sender, isBot: Boolean(m.is_bot), text: m.text, ts: m.ts }))
  return {
    conversationId: row.conversation_id,
    agent: row.agent,
    contact: row.contact,
    date: row.date,
    topic: row.topic,
    rawResponseSec: row.raw_response_sec,
    adjustedResponseSec: row.adjusted_response_sec,
    messagesRaw: messages,
    messages,
  }
}

export function mapDraftRow(r) {
  if (!r) return null
  return {
    id: r.id,
    conversationId: r.conversation_id,
    draftScores: JSON.parse(r.draft_scores),
    totalScore: r.total_score,
    passed: Boolean(r.passed),
    reasoning: r.reasoning,
    confidence: r.confidence,
    model: r.model,
    status: r.status,
    finalScores: r.final_scores ? JSON.parse(r.final_scores) : null,
    reviewNote: r.review_note,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  }
}

export function mapScoreRow(r) {
  if (!r) return null
  return {
    conversationId: r.conversation_id,
    scores: JSON.parse(r.scores),
    totalScore: r.total_score,
    passed: Boolean(r.passed),
    scoreOrigin: r.score_origin,
    comments: r.comments,
    scoredBy: r.scored_by,
    scoredDate: r.scored_date,
    approvedDraftId: r.approved_draft_id,
  }
}
