import './loadEnv.js'
import { serve } from '@hono/node-server'
import { openDb, resolveDbPath } from './db.js'
import { createApp } from './app.js'

const port = Number(process.env.PORT) || 3001
const token = process.env.QA_MCP_TOKEN
if (!token) console.warn('[api] QA_MCP_TOKEN is not set: /api/agent/* will reject every request.')

const db = openDb()
const app = createApp(db, { serviceToken: token })
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`[api] listening on http://127.0.0.1:${info.port}  (db: ${resolveDbPath()})`)
})
