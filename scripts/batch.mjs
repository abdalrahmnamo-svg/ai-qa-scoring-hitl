#!/usr/bin/env node
// Run one scoring batch: the scorer (mock by default) drafts scores through the MCP tool handlers.
// Drafts land as pending_human_review; open the Review Queue to approve or reject them.
// Usage: npm run batch [-- --date 2025-03-07 --per-agent 2]
import crypto from 'node:crypto'
import '../server/loadEnv.js'
import { openDb } from '../server/db.js'
import { createApp } from '../server/app.js'
import { createHandlers } from '../qa-mcp/handlers.js'
import { createScorer } from '../server/scorer.js'
import { runBatch, inProcessFetch } from '../server/agentRunner.js'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const db = openDb()
if (!db.prepare('SELECT 1 FROM conversations LIMIT 1').get()) {
  console.error('No conversations found. Run `npm run seed` first.')
  process.exit(1)
}

// In-process: both sides share a throwaway token, so no .env is needed to run the demo.
const token = process.env.QA_MCP_TOKEN || crypto.randomUUID()
const app = createApp(db, { serviceToken: token })
const handlers = createHandlers({ apiUrl: 'http://local', token, fetchImpl: inProcessFetch(app) })
const scorer = createScorer()

console.log(`scorer: ${scorer.mode} (${scorer.model})`)
const result = await runBatch({
  handlers,
  scorer,
  date: arg('--date'),
  perAgent: Number(arg('--per-agent')) || 2,
  log: console.log,
})
console.log(
  `done: ${result.submitted.length} draft(s) submitted, ${result.guardRejected.length} rejected by guard, ${result.blocked.length} blocked. ` +
    'Nothing is official until a human approves it.',
)
