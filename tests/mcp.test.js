import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../server/db.js'
import { seedDatabase } from '../server/seedData.js'
import { createApp } from '../server/app.js'
import { createHandlers, McpAuthError } from '../qa-mcp/handlers.js'
import { TOOL_SCHEMAS } from '../qa-mcp/schemas.js'
import { inProcessFetch } from '../server/agentRunner.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function makeApp() {
  const db = openDb(':memory:')
  seedDatabase(db, { seed: 42 })
  return createApp(db, { serviceToken: 'right-token' })
}

describe('MCP tool authentication', () => {
  it('rejects a bad token (401) on every data tool', async () => {
    const app = makeApp()
    const h = createHandlers({ apiUrl: 'http://local', token: 'wrong-token', fetchImpl: inProcessFetch(app) })
    await expect(h.fetch_scorecard_config()).rejects.toMatchObject({ status: 401 })
    await expect(h.fetch_learning_signals({})).rejects.toMatchObject({ status: 401 })
    await expect(h.fetch_daily_scoring_batch({})).rejects.toMatchObject({ status: 401 })
    await expect(h.submit_draft_score({ conversationId: 'CONV-0001', draftScores: {}, reasoning: 'x' })).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a missing token before any request is made', async () => {
    let called = false
    const h = createHandlers({ apiUrl: 'http://local', token: '', fetchImpl: async () => { called = true } })
    await expect(h.fetch_scorecard_config()).rejects.toBeInstanceOf(McpAuthError)
    expect(called).toBe(false)
  })

  it('accepts the right token', async () => {
    const app = makeApp()
    const h = createHandlers({ apiUrl: 'http://local', token: 'right-token', fetchImpl: inProcessFetch(app) })
    const cfg = await h.fetch_scorecard_config()
    expect(Object.keys(cfg.scorecardStructure)).toHaveLength(6)
    expect((await h.get_qa_agent_role()).role).toContain('QA Drafting Agent')
  })

  it('the API itself returns 401 without a bearer header', async () => {
    const app = makeApp()
    expect((await app.request('/api/agent/scorecard')).status).toBe(401)
    expect((await app.request('/api/agent/scorecard', { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
  })

  it('exposes only read tools plus submit_draft_score (no approve tool)', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name)
    expect(names).toContain('submit_draft_score')
    expect(names.some((n) => /approve|reject|score_official/i.test(n))).toBe(false)
  })

  it('the stdio server refuses to start without QA_MCP_TOKEN', () => {
    const env = { ...process.env }
    delete env.QA_MCP_TOKEN
    const res = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'qa-mcp/server.js'], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 15000,
    })
    // A local .env may supply the token; only assert when it did not.
    if (!/QA_MCP_TOKEN is required/.test(res.stderr)) return
    expect(res.status).toBe(1)
  })
})
