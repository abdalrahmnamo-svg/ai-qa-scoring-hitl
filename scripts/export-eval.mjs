#!/usr/bin/env node
/**
 * Export the golden-set comparison (AI draft vs human score) as tidy CSVs for the analysis notebook.
 *
 * Mirrors server/goldenEval.js: the scorer drafts every golden conversation with no reviewer feedback,
 * g2 is overridden deterministically, and the draft is compared with the held-out human score.
 *
 * Writes to analysis/data/ (git-ignored except sample_eval.csv):
 *   eval_criteria.csv      one row per golden conversation x criterion
 *   eval_conversations.csv one row per golden conversation (totals, pass/fail, confidence)
 *
 * Usage: npm run eval:export   (run `npm run seed` first; `npm run batch` is optional)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import '../server/loadEnv.js'
import { openDb, loadScorecard, getConversation, mapScoreRow } from '../server/db.js'
import { createScorer } from '../server/scorer.js'
import { computeDeterministicCriteria } from '../server/deterministicCriteria.js'
import { sumDraftPoints, flattenDraftScores } from '../server/draftScoreHelpers.js'
import { projectAgentConversation } from '../server/agentProjection.js'
import { buildCriterionList } from '../server/scorecardShape.js'
import { PASS_THRESHOLD } from '../src/utils/defaultScorecardConfig.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, '..', 'analysis', 'data')

const csvCell = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (cols, rows) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'

const db = openDb()
const scorecard = loadScorecard(db)
const criteria = buildCriterionList(scorecard.scorecardStructure)
const golden = db.prepare("SELECT * FROM scores WHERE score_origin = 'golden' ORDER BY conversation_id").all().map(mapScoreRow)
if (!golden.length) {
  console.error('No golden scores found. Run `npm run seed` first.')
  process.exit(1)
}

const scorer = createScorer()
const critRows = []
const convRows = []
for (const gold of golden) {
  const conv = getConversation(db, gold.conversationId)
  const draft = await scorer.score({ conversation: projectAgentConversation(conv), scorecard, signals: null })
  const { overrides } = computeDeterministicCriteria({ conversation: conv, scorecard })
  const ai = { ...draft.draftScores, ...overrides }
  const aiTotal = sumDraftPoints(ai)
  const aiFlat = flattenDraftScores(ai)
  const confidence = typeof draft.confidence === 'number' ? draft.confidence : ''
  const base = {
    conversation_id: gold.conversationId,
    agent: conv.agent,
    date: conv.date,
    ai_total: aiTotal,
    human_total: gold.totalScore,
    ai_pass: aiTotal >= PASS_THRESHOLD ? 1 : 0,
    human_pass: gold.totalScore >= PASS_THRESHOLD ? 1 : 0,
    ai_confidence: confidence,
  }
  convRows.push({ ...base, scorer: `${scorer.mode}:${scorer.model}` })
  for (const c of criteria) {
    critRows.push({
      ...base,
      criterion_id: c.id,
      criterion_label: c.label,
      section: c.section,
      max_points: c.maxPoints,
      ai_points: aiFlat[c.id] ?? 0,
      human_points: gold.scores[c.id] ?? 0,
      deterministic: overrides[c.id] ? 1 : 0,
    })
  }
}

const critCols = ['conversation_id', 'agent', 'date', 'criterion_id', 'criterion_label', 'section', 'max_points', 'ai_points', 'human_points', 'deterministic', 'ai_total', 'human_total', 'ai_pass', 'human_pass', 'ai_confidence']
const convCols = ['conversation_id', 'agent', 'date', 'ai_total', 'human_total', 'ai_pass', 'human_pass', 'ai_confidence', 'scorer']
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'eval_criteria.csv'), toCsv(critCols, critRows))
fs.writeFileSync(path.join(outDir, 'eval_conversations.csv'), toCsv(convCols, convRows))
console.log(`exported ${golden.length} golden conversations x ${criteria.length} criteria = ${critRows.length} rows to ${path.relative(process.cwd(), outDir)}`)
