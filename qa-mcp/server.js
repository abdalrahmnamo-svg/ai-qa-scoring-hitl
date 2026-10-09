#!/usr/bin/env node
// qa-mcp/server.js: stdio MCP server for the QA drafting agent.
//
// It calls the HTTP API with a bearer service token and never touches the database. Trust boundary:
// it can read data and write DRAFTS, but a draft becomes an official score only through the
// human-gated approve route, which this token cannot reach.

import '../server/loadEnv.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOL_SCHEMAS } from './schemas.js'
import { createHandlers } from './handlers.js'

if (!process.env.QA_MCP_TOKEN) {
  console.error('[qa-mcp] QA_MCP_TOKEN is required (set it in .env or the MCP client env block; it must match the API).')
  process.exit(1)
}

const HANDLERS = createHandlers()
const server = new Server({ name: 'qa-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_SCHEMAS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  const handler = HANDLERS[name]
  if (!handler) return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
  try {
    const result = await handler(args || {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e?.message || String(e)}` }], isError: true }
  }
})

await server.connect(new StdioServerTransport())
console.error('[qa-mcp] connected (stdio). Call get_qa_agent_role first; see AGENT_ROLE.md.')
