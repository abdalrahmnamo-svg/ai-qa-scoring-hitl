// qa-mcp/handlers.js: each tool is a thin, authenticated call to the HTTP API.
// The MCP server never opens the database. The API is the single policy-enforcement point, and the
// service token only unlocks /api/agent/* (read data, submit DRAFTS). It cannot approve anything.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROLE_PATH = path.join(here, 'AGENT_ROLE.md')

export class McpAuthError extends Error {
  constructor(message) {
    super(message)
    this.name = 'McpAuthError'
  }
}

/**
 * @param {{ apiUrl?: string, token?: string, fetchImpl?: (url: string, init?: object) => Promise<Response> }} [cfg]
 *   `fetchImpl` lets tests and the batch runner call the app in-process instead of over the network.
 */
export function createHandlers({
  apiUrl = process.env.QA_API_URL || 'http://127.0.0.1:3001',
  token = process.env.QA_MCP_TOKEN,
  fetchImpl = fetch,
} = {}) {
  async function api(pathname, init = {}) {
    const bearer = String(token || '').trim()
    if (!bearer) throw new McpAuthError('QA_MCP_TOKEN is required (set it in .env or the MCP server env).')
    const res = await fetchImpl(`${apiUrl}${pathname}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, ...(init.headers || {}) },
    })
    const text = await res.text()
    if (!res.ok) {
      const err = new Error(`${init.method || 'GET'} ${pathname} -> ${res.status} ${text.slice(0, 600)}`)
      err.status = res.status
      throw err
    }
    return text ? JSON.parse(text) : {}
  }

  return {
    async get_qa_agent_role() {
      return { role: fs.readFileSync(ROLE_PATH, 'utf8') }
    },

    async fetch_scorecard_config() {
      return api('/api/agent/scorecard')
    },

    async fetch_learning_signals({ sinceDays = 30, limit = 50 } = {}) {
      return api(`/api/agent/learning-signals?${new URLSearchParams({ sinceDays: String(sinceDays), limit: String(limit) })}`)
    },

    async fetch_scored_examples({ limit = 10, agent } = {}) {
      const qs = new URLSearchParams({ limit: String(limit) })
      if (agent) qs.set('agent', agent)
      const { examples } = await api(`/api/agent/scored-examples?${qs}`)
      return examples
    },

    async fetch_daily_scoring_batch({ date, perAgent = 2 } = {}) {
      const qs = new URLSearchParams({ perAgent: String(perAgent) })
      if (date) qs.set('date', date)
      return api(`/api/agent/daily-batch?${qs}`)
    },

    async fetch_unscored_conversations({ limit = 10, agent, from, to } = {}) {
      const qs = new URLSearchParams({ limit: String(limit) })
      if (agent) qs.set('agent', agent)
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const { conversations } = await api(`/api/agent/unscored?${qs}`)
      return conversations
    },

    async submit_draft_score({ conversationId, draftScores, reasoning, confidence, model } = {}) {
      if (!conversationId) throw new Error('submit_draft_score requires conversationId')
      const body = { conversationId, draftScores, reasoning, model: model || process.env.ANTHROPIC_MODEL || 'unspecified' }
      if (typeof confidence === 'number') body.confidence = confidence
      return api('/api/agent/drafts', { method: 'POST', body: JSON.stringify(body) })
    },
  }
}
